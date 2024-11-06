import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { routerFixture } from "./shared/fixtures";
import { expect } from "chai";
import { Addressable, AddressLike, parseEther, ZeroAddress } from "ethers";
import { ethers } from "hardhat";
import { hours } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";

describe("Governance", function () {
  it("deploys governance", async () => {
    const { gToken } = await loadFixture(routerFixture);

    expect(await gToken.name()).to.eq("GainzSwap Governance Token");
  });

  describe("stake", function () {
    it("Should mint GToken with correct attributes", async function () {
      const {
        governance,
        gToken,
        users: [user],
        createPair,
      } = await loadFixture(routerFixture);

      const [{ token: tokenA }, { token: tokenB }] = await createPair();

      const epochsLocked = 1080;
      const stakeAmount = parseEther("0.05");

      const tokenBcontract = await ethers.getContractAt("TestERC20", tokenB as Addressable);
      await tokenBcontract.mintApprove(user, governance, stakeAmount);

      // Act for native coin staking

      await governance
        .connect(user)
        .stake({ token: tokenA, nonce: 0, amount: stakeAmount }, epochsLocked, [[tokenA], [tokenA, tokenB], []], 0, 0, {
          value: stakeAmount,
        });

      // Assert for native coin staking

      const { attributes: nativeStakingAttr } = await gToken.getBalanceAt(user, 1);

      expect(nativeStakingAttr.rewardPerShare).to.equal(0);
      expect(nativeStakingAttr.epochStaked).to.equal(0);
      expect(nativeStakingAttr.stakeWeight).to.gt(0);
      expect(nativeStakingAttr.epochsLocked).to.equal(epochsLocked);
      expect(nativeStakingAttr.lpDetails.liquidity).to.gt(0);
      expect(nativeStakingAttr.lpDetails.liqValue).to.gt(0);

      // Act for ERC20 staking

      await governance
        .connect(user)
        .stake({ token: tokenB, nonce: 0, amount: stakeAmount }, epochsLocked, [[tokenB], [tokenB, tokenA], []], 0, 0);

      // Assert for ERC20 staking

      const { attributes: erc20StakingAttr } = await gToken.getBalanceAt(user, 2);

      expect(erc20StakingAttr.rewardPerShare).to.equal(0);
      expect(erc20StakingAttr.epochStaked).to.equal(0);
      expect(erc20StakingAttr.stakeWeight).to.gt(0);
      expect(erc20StakingAttr.epochsLocked).to.equal(epochsLocked);
      expect(erc20StakingAttr.lpDetails.liquidity).to.gt(0);
      expect(erc20StakingAttr.lpDetails.liqValue).to.gt(0);
    });

    it("Should calculate liquidity value for tokenA with a 5-hop path to the native token", async () => {
      // Deploy tokens and initialize contracts
      const {
        governance,
        gToken,
        users: [user],
        wrappedNativeToken,
        createToken,
        createPair,
      } = await loadFixture(routerFixture);

      // Deploy tokenA, tokenB, and intermediary tokens
      const tokenA = await createToken(5);
      const tokenB = await createToken(9);
      const intermediate1 = await createToken(2);
      const intermediate2 = await createToken(3);
      const intermediate3 = await createToken(4);
      const intermediate4 = await createToken(5);

      // Create path to native token with 5 hops
      const pathToNative = [tokenA, intermediate1, intermediate2, intermediate3, intermediate4, wrappedNativeToken];

      // Create pairs to link to the path
      let pairsCreated = 0;
      for (const [[token1, amount1], [token2, amount2]] of [
        [
          [tokenA, parseEther("0.05")],
          [tokenB, parseEther("10")],
        ],
        [
          [tokenA, parseEther("0.05")],
          [intermediate1, parseEther("20")],
        ],
        [
          [intermediate1, parseEther("20")],
          [intermediate2, parseEther("30")],
        ],
        [
          [intermediate2, parseEther("30")],
          [intermediate3, parseEther("40")],
        ],
        [
          [intermediate3, parseEther("40")],
          [intermediate4, parseEther("50")],
        ],
        [
          [intermediate4, parseEther("50")],
          [ZeroAddress, parseEther("0.0009")],
        ],
      ] as [[AddressLike, bigint], [AddressLike, bigint]][]) {
        await createPair({
          paymentA: { token: token1, nonce: 0, amount: amount1 },
          paymentB: { token: token2, nonce: 0, amount: amount2 },
          pairsCreated: ++pairsCreated,
        });
      }

      // Approve and stake with the given path
      const payment = { token: wrappedNativeToken, amount: parseEther("0.0001"), nonce: 0 };

      const nativeToTokenAPath = pathToNative.slice().reverse();
      await governance.connect(user).stake(
        payment,
        1080, // Epochs locked
        [nativeToTokenAPath, [...nativeToTokenAPath, tokenB], pathToNative], // Paths for A, B, and to native
        0, // amountOutMinA
        0, // amountOutMinB
        { value: payment.amount },
      );

      // Fetch and assert native liquidity value
      const { attributes: gTokenAttributes } = await gToken.getBalanceAt(user, 1);
      expect(gTokenAttributes.lpDetails.liqValue).to.be.gt(0); // Liquidity value should be greater than zero
      expect(gTokenAttributes.epochsLocked).to.equal(1080); // Correct epochs locked
    });
  });

  describe("claimRewards", function () {
    it("Should allow a user to claim rewards if available", async function () {
      const {
        users: [user, governanceDonor],
        governance,
        gainzToken,
        gToken,
        createPair,
      } = await loadFixture(routerFixture);
      const stakeAmount = parseEther("0.05");
      const epochsLocked = 1080;
      const nonce = 1; // assume staking gives us nonce 1
      const rewardAmount = parseEther("0.02");

      // Setup: Mint and approve tokenB for staking
      const [{ token: tokenA }, { token: tokenB }] = await createPair();
      const tokenBcontract = await ethers.getContractAt("TestERC20", tokenB as Addressable);
      await tokenBcontract.mintApprove(user, governance, stakeAmount);

      // Stake to initiate rewards
      await governance
        .connect(user)
        .stake({ token: tokenB, nonce: 0, amount: stakeAmount }, epochsLocked, [[tokenB], [tokenB, tokenA], []], 0, 0);

      // Add rewards to the reserve
      await gainzToken.mintApprove(governanceDonor, governance, rewardAmount);
      await governance.connect(governanceDonor).updateRewardReserve(rewardAmount);

      // Act: Claim rewards
      const userBalanceBefore = await gainzToken.balanceOf(user);
      await governance.connect(user).claimRewards(nonce);
      const userBalanceAfter = await gainzToken.balanceOf(user);

      // Assert: Rewards transferred
      expect(userBalanceAfter - userBalanceBefore).to.equal(rewardAmount - 1n); // Minusing 1 due to precision issues
      expect((await gToken.getBalanceAt(user, nonce + 1)).attributes.rewardPerShare).to.eq(
        await governance.rewardPerShare(),
      );
    });

    // it("Should revert if there are no rewards to claim", async function () {
    //   const [user] = users;
    //   const stakeAmount = parseEther("0.05");
    //   const epochsLocked = 1080;
    //   const nonce = 1;

    //   // Setup: Mint and approve tokenB for staking
    //   const [{ token: tokenA }, { token: tokenB }] = await createPair();
    //   const tokenBcontract = await ethers.getContractAt("TestERC20", tokenB as Addressable);
    //   await tokenBcontract.mintApprove(user, governance, stakeAmount);

    //   // Stake to initiate position
    //   await governance
    //     .connect(user)
    //     .stake(
    //       { token: tokenB, nonce: 0, amount: stakeAmount },
    //       epochsLocked,
    //       [[tokenB], [tokenB, tokenA], []],
    //       0,
    //       0
    //     );

    //   // Act and Assert: Attempt to claim without rewards should revert
    //   await expect(governance.connect(user).claimRewards(nonce)).to.be.revertedWith(
    //     "Governance: No rewards to claim"
    //   );
    // });

    // it("Should decrease the rewards reserve after claiming", async function () {
    //   const [user] = users;
    //   const stakeAmount = parseEther("0.05");
    //   const epochsLocked = 1080;
    //   const nonce = 1;
    //   const rewardAmount = parseEther("0.02");

    //   // Setup: Mint and approve tokenB for staking
    //   const [{ token: tokenA }, { token: tokenB }] = await createPair();
    //   const tokenBcontract = await ethers.getContractAt("TestERC20", tokenB as Addressable);
    //   await tokenBcontract.mintApprove(user, governance, stakeAmount);

    //   // Stake to initiate rewards
    //   await governance
    //     .connect(user)
    //     .stake(
    //       { token: tokenB, nonce: 0, amount: stakeAmount },
    //       epochsLocked,
    //       [[tokenB], [tokenB, tokenA], []],
    //       0,
    //       0
    //     );

    //   // Add rewards to the reserve
    //   await gainzToken.mint(governance.address, rewardAmount);
    //   await governance.updateRewardReserve(rewardAmount);

    //   // Capture the initial rewards reserve
    //   const reserveBefore = await governance.rewardsReserve();

    //   // Act: Claim rewards
    //   await governance.connect(user).claimRewards(nonce);

    //   // Assert: Rewards reserve is reduced correctly
    //   const reserveAfter = await governance.rewardsReserve();
    //   expect(reserveBefore.sub(reserveAfter)).to.equal(rewardAmount);
    // });

    // it("Should update the user's reward attributes after claiming", async function () {
    //   const [user] = users;
    //   const stakeAmount = parseEther("0.05");
    //   const epochsLocked = 1080;
    //   const nonce = 1;
    //   const rewardAmount = parseEther("0.02");

    //   // Setup: Mint and approve tokenB for staking
    //   const [{ token: tokenA }, { token: tokenB }] = await createPair();
    //   const tokenBcontract = await ethers.getContractAt("TestERC20", tokenB as Addressable);
    //   await tokenBcontract.mintApprove(user, governance, stakeAmount);

    //   // Stake to initiate rewards
    //   await governance
    //     .connect(user)
    //     .stake(
    //       { token: tokenB, nonce: 0, amount: stakeAmount },
    //       epochsLocked,
    //       [[tokenB], [tokenB, tokenA], []],
    //       0,
    //       0
    //     );

    //   // Add rewards to the reserve
    //   await gainzToken.mint(governance.address, rewardAmount);
    //   await governance.updateRewardReserve(rewardAmount);

    //   // Act: Claim rewards
    //   await governance.connect(user).claimRewards(nonce);

    //   // Assert: Check user's updated attributes
    //   const { attributes } = await gToken.getBalanceAt(user, nonce);
    //   expect(attributes.rewardPerShare).to.equal(await governance.rewardPerShare());
    //   expect(attributes.lastClaimEpoch).to.equal(await governance.currentEpoch());
    // });

    // it("Should return the correct nonce after claiming rewards", async function () {
    //   const [user] = users;
    //   const stakeAmount = parseEther("0.05");
    //   const epochsLocked = 1080;
    //   const nonce = 1;
    //   const rewardAmount = parseEther("0.02");

    //   // Setup: Mint and approve tokenB for staking
    //   const [{ token: tokenA }, { token: tokenB }] = await createPair();
    //   const tokenBcontract = await ethers.getContractAt("TestERC20", tokenB as Addressable);
    //   await tokenBcontract.mintApprove(user, governance, stakeAmount);

    //   // Stake to initiate rewards
    //   await governance
    //     .connect(user)
    //     .stake(
    //       { token: tokenB, nonce: 0, amount: stakeAmount },
    //       epochsLocked,
    //       [[tokenB], [tokenB, tokenA], []],
    //       0,
    //       0
    //     );

    //   // Add rewards to the reserve
    //   await gainzToken.mint(governance.address, rewardAmount);
    //   await governance.updateRewardReserve(rewardAmount);

    //   // Act: Claim rewards
    //   const returnedNonce = await governance.connect(user).claimRewards(nonce);

    //   // Assert: Returned nonce matches
    //   expect(returnedNonce).to.equal(nonce);
    // });
  });
});
