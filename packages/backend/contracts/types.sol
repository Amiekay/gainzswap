// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

import "hardhat/console.sol";

struct LiquidityInfo {
	address token0;
	address token1;
	uint256 liquidity;
	uint256 liqValue;
}

function createLiquidityInfoArray(
	LiquidityInfo memory element
) pure returns (LiquidityInfo[] memory array) {
	array = new LiquidityInfo[](1);
	array[0] = element;
}
