// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title XSpan Research Partner Access Control
/// @notice KYC verification registry for research partners (pharma, institutions)
/// @dev Only XSpan admin can verify research partners after off-chain KYC
contract BuyerAccessControl is Ownable {
    struct Buyer {
        bool verified;
        string orgName;
        uint256 verifiedAt;
        uint256 revokedAt;
    }

    mapping(address => Buyer) public buyers;
    uint256 public verifiedBuyerCount;

    event BuyerVerified(address indexed buyer, string orgName, uint256 timestamp);
    event BuyerRevoked(address indexed buyer, uint256 timestamp);

    error BuyerAlreadyVerified();
    error BuyerNotVerified();

    constructor() Ownable(msg.sender) {}

    /// @notice Verify a buyer after off-chain KYC (admin only)
    /// @param buyer Wallet address of the buyer
    /// @param orgName Organization name (e.g., "Pfizer Inc.")
    function verifyBuyer(address buyer, string calldata orgName) external onlyOwner {
        if (buyers[buyer].verified) revert BuyerAlreadyVerified();

        buyers[buyer] = Buyer({
            verified: true,
            orgName: orgName,
            verifiedAt: block.timestamp,
            revokedAt: 0
        });

        verifiedBuyerCount++;
        emit BuyerVerified(buyer, orgName, block.timestamp);
    }

    /// @notice Revoke buyer access (admin only)
    function revokeBuyer(address buyer) external onlyOwner {
        if (!buyers[buyer].verified) revert BuyerNotVerified();

        buyers[buyer].verified = false;
        buyers[buyer].revokedAt = block.timestamp;
        verifiedBuyerCount--;

        emit BuyerRevoked(buyer, block.timestamp);
    }

    /// @notice Check if an address is a verified buyer
    function isVerifiedBuyer(address buyer) external view returns (bool) {
        return buyers[buyer].verified;
    }
}
