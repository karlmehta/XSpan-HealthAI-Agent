// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ConsentRegistry.sol";
import "../src/BuyerAccessControl.sol";
import "../src/DataRegistry.sol";
import "../src/DataExchange.sol";

contract DeployContribute is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("PROTOCOL_TREASURY");
        address community = vm.envAddress("COMMUNITY_FUND");

        vm.startBroadcast(deployerKey);

        // 1. Deploy ConsentRegistry
        ConsentRegistry consent = new ConsentRegistry();
        console.log("ConsentRegistry:", address(consent));

        // 2. Deploy BuyerAccessControl
        BuyerAccessControl buyerAccess = new BuyerAccessControl();
        console.log("BuyerAccessControl:", address(buyerAccess));

        // 3. Deploy DataRegistry (needs ConsentRegistry address)
        DataRegistry registry = new DataRegistry(address(consent));
        console.log("DataRegistry:", address(registry));

        // 4. Deploy DataExchange (needs all addresses)
        DataExchange exchange = new DataExchange(
            usdc,
            address(registry),
            address(buyerAccess),
            treasury,
            community
        );
        console.log("DataExchange:", address(exchange));

        vm.stopBroadcast();

        // Log summary
        console.log("\n=== XSpan Contribute Contracts Deployed ===");
        console.log("ConsentRegistry:    ", address(consent));
        console.log("BuyerAccessControl: ", address(buyerAccess));
        console.log("DataRegistry:       ", address(registry));
        console.log("DataExchange:       ", address(exchange));
        console.log("USDC:               ", usdc);
        console.log("Treasury:           ", treasury);
        console.log("Community Fund:     ", community);
    }
}
