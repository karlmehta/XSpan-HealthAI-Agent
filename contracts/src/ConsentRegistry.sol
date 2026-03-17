// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title XSpan Consent Registry
/// @notice On-chain consent records for XSpan Contribute (Research Data Contribution Program)
/// @dev Consent is required before a contributor can list datasets
contract ConsentRegistry {
    struct Consent {
        uint8 version;
        bytes32 consentHash; // SHA-256 of the consent document
        uint256 grantedAt;
        uint256 revokedAt; // 0 if active
        bool active;
    }

    mapping(address => Consent) public consents;

    event ConsentGranted(address indexed seller, uint8 version, bytes32 consentHash, uint256 timestamp);
    event ConsentRevoked(address indexed seller, uint256 timestamp);

    error ConsentAlreadyActive();
    error ConsentNotActive();

    /// @notice Grant consent to participate in the Contribute Program
    /// @param consentHash SHA-256 hash of the full consent document shown to user
    /// @param version Version number of the consent form
    function grantConsent(bytes32 consentHash, uint8 version) external {
        if (consents[msg.sender].active) revert ConsentAlreadyActive();

        consents[msg.sender] = Consent({
            version: version,
            consentHash: consentHash,
            grantedAt: block.timestamp,
            revokedAt: 0,
            active: true
        });

        emit ConsentGranted(msg.sender, version, consentHash, block.timestamp);
    }

    /// @notice Revoke consent — delists all active datasets (handled by DataRegistry)
    function revokeConsent() external {
        if (!consents[msg.sender].active) revert ConsentNotActive();

        consents[msg.sender].active = false;
        consents[msg.sender].revokedAt = block.timestamp;

        emit ConsentRevoked(msg.sender, block.timestamp);
    }

    /// @notice Check if a seller has active consent
    function hasActiveConsent(address seller) external view returns (bool) {
        return consents[seller].active;
    }

    /// @notice Get consent details for a seller
    function getConsent(address seller) external view returns (Consent memory) {
        return consents[seller];
    }
}
