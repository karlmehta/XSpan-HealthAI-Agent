// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./DataRegistry.sol";
import "./BuyerAccessControl.sol";

/// @title XSpan Contribute Exchange
/// @notice Research access grants, escrow, delivery, and contribution reward distribution
/// @dev Revenue split: 50% contributor, 20% health system partner (if any), 25% protocol, 5% community
contract DataExchange is Ownable {
    using SafeERC20 for IERC20;

    // Revenue split in basis points (10000 = 100%)
    uint256 public constant SELLER_BPS = 5000; // 50%
    uint256 public constant PARTNER_BPS = 2000; // 20% (if partner exists)
    uint256 public constant PROTOCOL_BPS_WITH_PARTNER = 2500; // 25%
    uint256 public constant PROTOCOL_BPS_NO_PARTNER = 4500; // 45%
    uint256 public constant COMMUNITY_BPS = 500; // 5%

    enum PurchaseStatus { Pending, Delivered, Disputed, Refunded }

    struct Purchase {
        bytes32 purchaseId;
        bytes32 datasetId;
        address buyer;
        uint256 amountUsdc;
        PurchaseStatus status;
        uint256 purchasedAt;
        uint256 deliveredAt;
    }

    IERC20 public immutable usdc;
    DataRegistry public immutable dataRegistry;
    BuyerAccessControl public immutable buyerAccess;

    address public protocolTreasury;
    address public communityFund;

    mapping(bytes32 => Purchase) public purchases;
    mapping(address => bytes32[]) public buyerPurchases;
    mapping(address => uint256) public sellerEarnings;
    mapping(address => uint256) public partnerEarnings;

    uint256 public totalVolume;
    uint256 public totalPurchases;

    event DatasetPurchased(
        bytes32 indexed purchaseId,
        bytes32 indexed datasetId,
        address indexed buyer,
        uint256 amountUsdc,
        uint256 timestamp
    );
    event DeliveryConfirmed(
        bytes32 indexed purchaseId,
        address indexed seller,
        uint256 sellerPayout,
        uint256 partnerPayout,
        uint256 protocolPayout,
        uint256 communityPayout
    );
    event DeliveryDisputed(bytes32 indexed purchaseId, address indexed buyer, uint256 timestamp);
    event DisputeResolved(bytes32 indexed purchaseId, bool refunded, uint256 timestamp);

    error NotVerifiedBuyer();
    error ListingNotActive();
    error InsufficientAllowance();
    error PurchaseNotPending();
    error NotPurchaseBuyer();
    error InvalidAddress();

    constructor(
        address _usdc,
        address _dataRegistry,
        address _buyerAccess,
        address _protocolTreasury,
        address _communityFund
    ) Ownable(msg.sender) {
        if (_usdc == address(0) || _protocolTreasury == address(0) || _communityFund == address(0)) {
            revert InvalidAddress();
        }
        usdc = IERC20(_usdc);
        dataRegistry = DataRegistry(_dataRegistry);
        buyerAccess = BuyerAccessControl(_buyerAccess);
        protocolTreasury = _protocolTreasury;
        communityFund = _communityFund;
    }

    /// @notice Purchase a dataset — USDC moves to escrow (this contract)
    function purchaseDataset(bytes32 datasetId) external returns (bytes32 purchaseId) {
        if (!buyerAccess.isVerifiedBuyer(msg.sender)) revert NotVerifiedBuyer();

        DataRegistry.DataListing memory listing = dataRegistry.getListing(datasetId);
        if (!listing.active) revert ListingNotActive();

        // Transfer USDC from buyer to this contract (escrow)
        usdc.safeTransferFrom(msg.sender, address(this), listing.priceUsdc);

        purchaseId = keccak256(abi.encodePacked(datasetId, msg.sender, block.timestamp));

        purchases[purchaseId] = Purchase({
            purchaseId: purchaseId,
            datasetId: datasetId,
            buyer: msg.sender,
            amountUsdc: listing.priceUsdc,
            status: PurchaseStatus.Pending,
            purchasedAt: block.timestamp,
            deliveredAt: 0
        });

        buyerPurchases[msg.sender].push(purchaseId);
        totalPurchases++;
        totalVolume += listing.priceUsdc;

        emit DatasetPurchased(purchaseId, datasetId, msg.sender, listing.priceUsdc, block.timestamp);
    }

    /// @notice Confirm delivery — triggers revenue distribution from escrow
    function confirmDelivery(bytes32 purchaseId) external {
        Purchase storage purchase = purchases[purchaseId];
        if (purchase.buyer != msg.sender) revert NotPurchaseBuyer();
        if (purchase.status != PurchaseStatus.Pending) revert PurchaseNotPending();

        purchase.status = PurchaseStatus.Delivered;
        purchase.deliveredAt = block.timestamp;

        // Get listing to determine seller and partner
        DataRegistry.DataListing memory listing = dataRegistry.getListing(purchase.datasetId);
        uint256 amount = purchase.amountUsdc;

        // Calculate splits
        uint256 sellerPayout = (amount * SELLER_BPS) / 10_000;
        uint256 communityPayout = (amount * COMMUNITY_BPS) / 10_000;
        uint256 partnerPayout = 0;
        uint256 protocolPayout;

        if (listing.partner != address(0)) {
            partnerPayout = (amount * PARTNER_BPS) / 10_000;
            protocolPayout = amount - sellerPayout - partnerPayout - communityPayout;
        } else {
            protocolPayout = amount - sellerPayout - communityPayout;
        }

        // Distribute
        usdc.safeTransfer(listing.seller, sellerPayout);
        if (partnerPayout > 0) {
            usdc.safeTransfer(listing.partner, partnerPayout);
            partnerEarnings[listing.partner] += partnerPayout;
        }
        usdc.safeTransfer(protocolTreasury, protocolPayout);
        usdc.safeTransfer(communityFund, communityPayout);

        sellerEarnings[listing.seller] += sellerPayout;

        emit DeliveryConfirmed(purchaseId, listing.seller, sellerPayout, partnerPayout, protocolPayout, communityPayout);
    }

    /// @notice Dispute a delivery (buyer didn't receive valid data)
    function disputeDelivery(bytes32 purchaseId) external {
        Purchase storage purchase = purchases[purchaseId];
        if (purchase.buyer != msg.sender) revert NotPurchaseBuyer();
        if (purchase.status != PurchaseStatus.Pending) revert PurchaseNotPending();

        purchase.status = PurchaseStatus.Disputed;
        emit DeliveryDisputed(purchaseId, msg.sender, block.timestamp);
    }

    /// @notice Resolve a dispute (admin only)
    /// @param refund If true, refund buyer. If false, release to seller.
    function resolveDispute(bytes32 purchaseId, bool refund) external onlyOwner {
        Purchase storage purchase = purchases[purchaseId];
        require(purchase.status == PurchaseStatus.Disputed, "Not disputed");

        if (refund) {
            purchase.status = PurchaseStatus.Refunded;
            usdc.safeTransfer(purchase.buyer, purchase.amountUsdc);
        } else {
            purchase.status = PurchaseStatus.Delivered;
            purchase.deliveredAt = block.timestamp;

            DataRegistry.DataListing memory listing = dataRegistry.getListing(purchase.datasetId);
            uint256 amount = purchase.amountUsdc;
            uint256 sellerPayout = (amount * SELLER_BPS) / 10_000;
            uint256 communityPayout = (amount * COMMUNITY_BPS) / 10_000;
            uint256 partnerPayout = 0;
            uint256 protocolPayout;

            if (listing.partner != address(0)) {
                partnerPayout = (amount * PARTNER_BPS) / 10_000;
                protocolPayout = amount - sellerPayout - partnerPayout - communityPayout;
            } else {
                protocolPayout = amount - sellerPayout - communityPayout;
            }

            usdc.safeTransfer(listing.seller, sellerPayout);
            if (partnerPayout > 0) usdc.safeTransfer(listing.partner, partnerPayout);
            usdc.safeTransfer(protocolTreasury, protocolPayout);
            usdc.safeTransfer(communityFund, communityPayout);

            sellerEarnings[listing.seller] += sellerPayout;
            if (partnerPayout > 0) partnerEarnings[listing.partner] += partnerPayout;
        }

        emit DisputeResolved(purchaseId, refund, block.timestamp);
    }

    /// @notice Update treasury address (admin only)
    function setProtocolTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidAddress();
        protocolTreasury = newTreasury;
    }

    /// @notice Update community fund address (admin only)
    function setCommunityFund(address newFund) external onlyOwner {
        if (newFund == address(0)) revert InvalidAddress();
        communityFund = newFund;
    }

    /// @notice Get buyer's purchase history
    function getBuyerPurchases(address buyer) external view returns (bytes32[] memory) {
        return buyerPurchases[buyer];
    }
}
