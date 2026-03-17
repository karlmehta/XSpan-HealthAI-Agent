// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ConsentRegistry.sol";

/// @title XSpan Data Registry
/// @notice Dataset listing, metadata, and pricing for XSpan Contribute
contract DataRegistry {
    struct DataListing {
        bytes32 datasetId;
        address seller;
        address partner; // Health System Partner (address(0) if none)
        string ipfsCid; // IPFS content identifier
        bytes32 contentHash; // SHA-256 of unencrypted de-identified data
        uint256 priceUsdc; // Price in USDC (6 decimals)
        string[] tags; // ["cardiovascular", "sleep", "labs"]
        uint16 snapshotCount; // Number of biomarker snapshots
        uint16 daySpan; // Time range in days
        uint8 completenessAvg; // 0-100
        string demographicBucket; // "30-34_M_972" (age_sex_zip3)
        bool active;
        uint256 listedAt;
        uint256 updatedAt;
    }

    ConsentRegistry public immutable consentRegistry;

    mapping(bytes32 => DataListing) public listings;
    mapping(address => bytes32[]) public sellerListings;
    bytes32[] public activeListingIds;
    uint256 public totalListings;

    event DatasetListed(
        bytes32 indexed datasetId,
        address indexed seller,
        string ipfsCid,
        uint256 priceUsdc,
        uint256 timestamp
    );
    event DatasetUpdated(bytes32 indexed datasetId, string ipfsCid, uint256 priceUsdc, uint256 timestamp);
    event DatasetDelisted(bytes32 indexed datasetId, uint256 timestamp);

    error NoActiveConsent();
    error NotSeller();
    error ListingNotActive();
    error ListingAlreadyExists();
    error InvalidPrice();

    constructor(address _consentRegistry) {
        consentRegistry = ConsentRegistry(_consentRegistry);
    }

    /// @notice List a new dataset on the Contribute Program
    function listDataset(
        string calldata ipfsCid,
        bytes32 contentHash,
        uint256 priceUsdc,
        string[] calldata tags,
        uint16 snapshotCount,
        uint16 daySpan,
        uint8 completenessAvg,
        string calldata demographicBucket,
        address partner
    ) external returns (bytes32 datasetId) {
        if (!consentRegistry.hasActiveConsent(msg.sender)) revert NoActiveConsent();
        if (priceUsdc == 0) revert InvalidPrice();

        datasetId = keccak256(abi.encodePacked(ipfsCid, msg.sender, block.timestamp));

        if (listings[datasetId].listedAt != 0) revert ListingAlreadyExists();

        listings[datasetId] = DataListing({
            datasetId: datasetId,
            seller: msg.sender,
            partner: partner,
            ipfsCid: ipfsCid,
            contentHash: contentHash,
            priceUsdc: priceUsdc,
            tags: tags,
            snapshotCount: snapshotCount,
            daySpan: daySpan,
            completenessAvg: completenessAvg,
            demographicBucket: demographicBucket,
            active: true,
            listedAt: block.timestamp,
            updatedAt: block.timestamp
        });

        sellerListings[msg.sender].push(datasetId);
        activeListingIds.push(datasetId);
        totalListings++;

        emit DatasetListed(datasetId, msg.sender, ipfsCid, priceUsdc, block.timestamp);
    }

    /// @notice Update an existing listing (price, CID, metadata)
    function updateListing(
        bytes32 datasetId,
        string calldata ipfsCid,
        bytes32 contentHash,
        uint256 priceUsdc,
        uint16 snapshotCount,
        uint8 completenessAvg
    ) external {
        DataListing storage listing = listings[datasetId];
        if (listing.seller != msg.sender) revert NotSeller();
        if (!listing.active) revert ListingNotActive();
        if (priceUsdc == 0) revert InvalidPrice();

        listing.ipfsCid = ipfsCid;
        listing.contentHash = contentHash;
        listing.priceUsdc = priceUsdc;
        listing.snapshotCount = snapshotCount;
        listing.completenessAvg = completenessAvg;
        listing.updatedAt = block.timestamp;

        emit DatasetUpdated(datasetId, ipfsCid, priceUsdc, block.timestamp);
    }

    /// @notice Delist a dataset
    function delistDataset(bytes32 datasetId) external {
        DataListing storage listing = listings[datasetId];
        if (listing.seller != msg.sender) revert NotSeller();
        if (!listing.active) revert ListingNotActive();

        listing.active = false;
        emit DatasetDelisted(datasetId, block.timestamp);
    }

    /// @notice Delist all datasets for a seller (called when consent is revoked)
    function delistAllForSeller(address seller) external {
        bytes32[] storage ids = sellerListings[seller];
        for (uint256 i = 0; i < ids.length; i++) {
            if (listings[ids[i]].active) {
                listings[ids[i]].active = false;
                emit DatasetDelisted(ids[i], block.timestamp);
            }
        }
    }

    /// @notice Get listing details
    function getListing(bytes32 datasetId) external view returns (DataListing memory) {
        return listings[datasetId];
    }

    /// @notice Get all listing IDs for a seller
    function getSellerListings(address seller) external view returns (bytes32[] memory) {
        return sellerListings[seller];
    }

    /// @notice Get count of active listings
    function getActiveListingCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < activeListingIds.length; i++) {
            if (listings[activeListingIds[i]].active) count++;
        }
    }
}
