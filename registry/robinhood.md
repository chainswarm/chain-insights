# The exchange registry: robinhood

**The decentralized exchanges of robinhood and their factory, manager and
router contracts.** One row per exchange and role. The review rule, the
columns and the check are in the [README](README.md). The served copy is
[robinhood.json](robinhood.json), written by
`node scripts/pin-dex-registry.mjs registry/robinhood.md`.

Registry version: 8.

Recorded on: 2026-11-06.

## Rows

| dex | display | aliases | trail type | adapter | role | address | valid from block | example pool | pool floor | source link | verification |
|---|---|---|---|---|---|---|---|---|---|---|---|
| aero | Aero (Aerodrome and Velodrome, merged) | Aero, Aerodrome, Velodrome, AERO, Aero Slipstream | gauge | cl-gauge-v1 | factory | `0xc63d7338c178e805c544b8f897066bd3bbcbe136` | 93973839 | 0x7615926023bb149f36095645c2a81dc367d39750 | 30 | [Dromos deployment ledger](https://github.com/dromos-labs/metadex-slipstream-public/blob/main/deployment-addresses/cl-robinhood.json) | served |
| aero | Aero (Aerodrome and Velodrome, merged) |  | gauge | cl-gauge-v1 | router | `0x72e46c9edf828002fdbfdd0952419790576c0f18` | 94021838 | - | - | [census 2026-10-23](https://github.com/chainswarm/AP1000/blob/main/docs/evidence/2026-10-23-dex-protocol-skills.md) | served |
| aero | Aero (Aerodrome and Velodrome, merged) |  | gauge | cl-gauge-v1 | router | `0x0fef9e88a7b76bcdbf451780c6774fe32965ee98` | 0 | - | - | [Dromos metarouter ledger](https://github.com/dromos-labs/metadex-slipstream-public/blob/main/deployment-addresses/cl-robinhood.json) | served |
| aero | Aero (Aerodrome and Velodrome, merged) |  | gauge | cl-gauge-v1 | router | `0x9ee35bf1bd69a03c6f0393582030fce8bb93d418` | 0 | - | - | [Dromos CL ledger](https://github.com/dromos-labs/metadex-slipstream-public/blob/main/deployment-addresses/cl-robinhood.json) | served |
| aero | Aero (Aerodrome and Velodrome, merged) |  | gauge | cl-gauge-v1 | helper | `0x4857db576ee0e45f10525ec59527bfd10beec60b` | 93974253 | - | - | [position NFT named by the verified gauge](https://sourcify.dev/server/v2/contract/4663/0x89e91a960154b1ed6c093039a8f0725ab67d14e0) | served |
| aero | Aero (Aerodrome and Velodrome, merged) |  | gauge | cl-gauge-v1 | helper | `0xf437f62053acb121665b8fdbfea8f214fb8e589d` | 93974455 | - | - | [gauge factory of the verified gauge](https://sourcify.dev/server/v2/contract/4663/0x89e91a960154b1ed6c093039a8f0725ab67d14e0) | served |
| aero | Aero (Aerodrome and Velodrome, merged) |  | gauge | cl-gauge-v1 | helper | `0x220d17d3260f130a4f91a1ba2d21f8f75f624942` | 94581179 | - | - | [clone of the verified ArbCLGauge](https://sourcify.dev/server/v2/contract/4663/0x89e91a960154b1ed6c093039a8f0725ab67d14e0) | served |
| aero | Aero (Aerodrome and Velodrome, merged) |  | gauge | cl-gauge-v1 | helper | `0xe033f4bd3d7ccf537a2f954ecdc8eb1218e3b7a6` | 94581067 | - | - | [clone of the verified ArbCLGauge](https://sourcify.dev/server/v2/contract/4663/0x89e91a960154b1ed6c093039a8f0725ab67d14e0) | served |
| aero | Aero (Aerodrome and Velodrome, merged) |  | gauge | cl-gauge-v1 | helper | `0x750a4e760873c863daf22890b8db55f4c71f1114` | 94581160 | - | - | [clone of the verified ArbCLGauge](https://sourcify.dev/server/v2/contract/4663/0x89e91a960154b1ed6c093039a8f0725ab67d14e0) | served |
| aero | Aero (Aerodrome and Velodrome, merged) |  | gauge | cl-gauge-v1 | helper | `0x045ccb9d8a98cb748b39253005be2d6d5b955c14` | 94581169 | - | - | [clone of the verified ArbCLGauge](https://sourcify.dev/server/v2/contract/4663/0x89e91a960154b1ed6c093039a8f0725ab67d14e0) | served |
| aero | Aero (Aerodrome and Velodrome, merged) |  | gauge | cl-gauge-v1 | helper | `0x5874f5b8728776993de4c90c61473d76eeab90db` | 94581072 | - | - | [clone of the verified ArbCLGauge](https://sourcify.dev/server/v2/contract/4663/0x89e91a960154b1ed6c093039a8f0725ab67d14e0) | served |
| aero | Aero (Aerodrome and Velodrome, merged) |  | gauge | cl-gauge-v1 | helper | `0xe5b468c4e13b45ec10a1d22ace7e2c0fc0671da0` | 94581094 | - | - | [clone of the verified ArbCLGauge](https://sourcify.dev/server/v2/contract/4663/0x89e91a960154b1ed6c093039a8f0725ab67d14e0) | served |
| up | up. | up., up, UP, up33, UP33, up.finance | gauge | cl-gauge-v1 | factory | `0x1ac9db4a2608ba45d6127b1737949b51bb54b7f3` | 6184096 | 0x4e8649be40ae67ebbcff99c291b92ee03015917b | 800 | [DefiLlama up-v3](https://github.com/DefiLlama/dimension-adapters/blob/master/dexs/up-v3/index.ts) | served |
| up | up. |  | gauge | solidly-v2 | factory | `0xfa5429aeba338bea2bfcc1b9a889862ee395bc28` | 6180950 | - | - | [DefiLlama up-v2](https://github.com/DefiLlama/dimension-adapters/blob/master/dexs/up-v2/index.ts) | served |
| up | up. |  | gauge | cl-gauge-v1 | router | `0xc062b870e813fca720f1e002c234369ab3ab9415` | 0 | - | - | [lp-terminal contract map](https://github.com/lp-terminal/contracts/blob/main/robinhood.json) | served |
| up | up. |  | gauge | solidly-v2 | router | `0xf5198743240fac98db71868f34c70139b1eb0474` | 0 | - | - | [lp-terminal contract map](https://github.com/lp-terminal/contracts/blob/main/robinhood.json) | served |
| alandale | Alandale | Alandale, LUTE, alandale.xyz | gauge | cl-gauge-v1 | factory | `0x2fadf533d9a098310007978730554f842547fc5f` | 27916288 | 0x7a35168956f129c032ec035cc47383a605a71df0 | 25 | [0x-settler Alandale fork](https://github.com/0xProject/0x-settler/blob/master/src/core/univ3forks/Alandale.sol) | served |
| alandale | Alandale |  | gauge | cl-gauge-v1 | router | `0x8971d5a8f950f021e97583855925b021bfae2b35` | 0 | - | - | [HoodScan](https://hoodscan.co/project/alandale) | served |
| raphael | Raphael Exchange | Raphael, RAPH, Raphael Exchange, Raphael Finance | gauge | cl-gauge-v1 | factory | `0x5481864ddd46a2d798df0925c23b7846e776e5e3` | 0 | - | 20 | [DefiLlama raphael-slipstream](https://github.com/DefiLlama/dimension-adapters/blob/master/dexs/raphael-slipstream/index.ts) | served |
| raphael | Raphael Exchange |  | gauge | solidly-v2 | factory | `0x1a6745f84099fa7e84d1f3b34c23482865194bd1` | 0 | - | - | [HoodScan](https://hoodscan.co/project/raphael-exchange) | served |
| raphael | Raphael Exchange |  | gauge | cl-gauge-v1 | router | `0x2f0e010edc989bb4dc3bfaf07750480bc16285d4` | 0 | - | - | [HoodScan](https://hoodscan.co/project/raphael-exchange) | served |
| sheriff | Sheriff | Sheriff, Sheriff Exchange, sheriff.exchange | gauge | cl-gauge-v1 | factory | `0x9ac30d72168a4498ae5c80226f4d3c86278e8f80` | 0 | - | 7 | [0x-settler Sheriff fork](https://github.com/0xProject/0x-settler/blob/master/src/core/univ3forks/Sheriff.sol) | served |
| sheriff | Sheriff |  | gauge | cl-gauge-v1 | router | `0xcb0615a1478838dea20e57447309be97f45dca0f` | 0 | - | - | [HoodScan](https://hoodscan.co/project/sheriff) | served |
| topaz | Topaz DEX | Topaz, TOPAZ, Topaz DEX, topazdex.com | gauge | cl-gauge-v1 | factory | `0xaa5865dc3a60b25d305226d66fd573021f0d8ffb` | 0 | - | 6 | [DefiLlama topaz-cl](https://github.com/DefiLlama/dimension-adapters/blob/master/dexs/topaz-cl/index.ts) | served |
| topaz | Topaz DEX |  | gauge | cl-gauge-v1 | router | `0x2e7395a6e0de6ee1f390bece891069cd18ff8572` | 0 | - | - | [HoodScan](https://hoodscan.co/project/topaz-dex) | served |
| kittenswap | Kittenswap | Kittenswap, KITTEN, KittenSwap | gauge | cl-gauge-v1 | factory | `0x45362763166cfed6174d312fa1449ea1fc37988a` | 0 | 0x49ffa9b5cb6c94b2fc99e8649c3e4c18f619e149 | 5 | [Kittenswap deployed contracts](https://docs.kittenswap.finance/tokenomics/deployed-contracts.md) | served |
| kittenswap | Kittenswap |  | gauge | cl-gauge-v1 | router | `0x7064c7bb85979f008212877c4ce41285ddf5374c` | 0 | - | - | [Kittenswap deployed contracts](https://docs.kittenswap.finance/tokenomics/deployed-contracts.md) | served |
| morpheus | Morpheus | Morpheus, Morpheus Farm | gauge | cl-gauge-v1 | factory | `0xd7cb0e0692f2d55a17ba81c1fe5501d66774fc4a` | 0 | - | 6 | [DefiLlama uniswapV3 registry](https://github.com/DefiLlama/DefiLlama-Adapters/blob/main/registries/uniswapV3.js) | served |
| swaphood | SwapHood | SwapHood, SwapHood Finance, SWT, swaphood.finance | gauge | solidly-v2 | factory | `0xe7206ecac3a51afe7e6179182ad4130a26068dd1` | 0 | - | 20 | [SwapHood contract addresses](https://swaphood-finance.gitbook.io/swaphood-finance-docs/contract-addresses.md) | served |
| swaphood | SwapHood |  | gauge | solidly-v2 | router | `0x8f8056fec03159ebcc4aee1b8ea5a61d8fe405fc` | 0 | - | - | [SwapHood contract addresses](https://swaphood-finance.gitbook.io/swaphood-finance-docs/contract-addresses.md) | served |
| uniswap-v2 | Uniswap v2 | Uniswap v2, Uni v2 | plain | uniswap-v2 | factory | `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f` | 0 | 0x4a6a85252a6f6b383a5f747259ee157e65ff1307 | 10000 | [Uniswap v2 deployments](https://developers.uniswap.org/docs/protocols/v2/deployments) | served |
| uniswap-v2 | Uniswap v2 |  | plain | uniswap-v2 | router | `0x89e5db8b5aa49aa85ac63f691524311aeb649eba` | 8929 | - | - | [Sourcify UniswapV2Router02](https://sourcify.dev/server/v2/contract/4663/0x89e5db8b5aa49aa85ac63f691524311aeb649eba) | served |
| uniswap-v3 | Uniswap v3 | Uniswap v3, Uni v3 | plain | uniswap-v3 | factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | 0 | 0x10cc6bd38112cac182db90b6a71d8bb5939526ba | 200000 | [Uniswap v3 Robinhood deployment](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments) | served |
| eth-usdg-router | unnamed ETH/USDG swap router (routes into Uniswap v3 and v4) | ETH/USDG router, ETH/USDG swap router, USDG swap router | plain | uniswap-v3 | factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | 105000018 | 0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca | - | [scout-agent finding 164](https://github.com/chainswarm/scout-agent/issues/164) | served |
| eth-usdg-router | unnamed ETH/USDG swap router (routes into Uniswap v3 and v4) |  | plain | uniswap-v3 | router | `0x7a39b98d31f84152bc724bc5ddb41dbcb338f2a5` | 105000018 | 0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca | - | [scout-agent finding 164](https://github.com/chainswarm/scout-agent/issues/164) | served |
| uniswap-v4 | Uniswap v4 | Uniswap, UNI, Uniswap v4, Uni v4, PoolManager | vault | uniswap-v4 | manager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | 0 | - | - | [Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments) | served |
| uniswap-v4 | Uniswap v4 |  | vault | uniswap-v4 | helper | `0x204faca1764b154221e35c0d20abb3c525710498` | 65727895 | - | - | [Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments) | served |
| uniswap-v4 | Uniswap v4 |  | vault | uniswap-v4 | helper | `0x8876789976decbfcbbbe364623c63652db8c0904` | 18127 | - | - | [Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments) | served |
| pancakeswap | PancakeSwap Infinity | PancakeSwap, Pancake, CAKE, PancakeSwap Infinity | vault | pancake-infinity-cl | manager | `0xee04c68742e6bf434be8039580d2e89bbe55bc6f` | 0 | - | - | [PancakeSwap infinity config](https://github.com/pancakeswap/infinity-periphery/blob/main/script/config/robinhood-mainnet.json) | served |
| pancakeswap-v2 | PancakeSwap v2 | PancakeSwap v2, Pancake v2 | plain | uniswap-v2 | factory | `0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e` | 0 | - | 40 | [PancakeSwap infinity config](https://github.com/pancakeswap/infinity-periphery/blob/main/script/config/robinhood-mainnet.json) | served |
| pancakeswap-v3 | PancakeSwap v3 | PancakeSwap v3, Pancake v3 | plain | uniswap-v3 | factory | `0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865` | 0 | - | - | [PancakeSwap config](https://github.com/pancakeswap/infinity-periphery/blob/main/script/config/robinhood-mainnet.json) | served |
| sushiswap | SushiSwap V4 | Sushi, SushiSwap, SUSHI, Sushi V4 | vault | pancake-infinity-cl | manager | `0x81d732702f87d2d652ae79e9f52bf44928eca210` | 0 | - | - | [Sushi infinity deployments](https://github.com/sushi-labs/infinity-deployments/blob/main/chains/robinhood-mainnet.json) | served |
| orvex | Orvex | Orvex, Orvex MetaDEX, orvex.fi, ORVX | vault | pancake-infinity-cl | manager | `0xd01c774d4a66408326bc65728ac5ae5aaf004032` | 0 | - | - | [DefiLlama orvex](https://github.com/DefiLlama/dimension-adapters/blob/master/dexs/orvex.ts) | served |
| swaap | Swaap v2 | Swaap, Swaap Finance, swaap.xyz, Balancer, Balancer v2, Balancer v2 vault | vault | balancer-v2 | manager | `0xd315a9c38ec871068fec378e4ce78af528c76293` | 0 | - | - | [Swaap docs](https://docs.swaap.xyz/) | served |
| balancer-v3 | unnamed Balancer v3 vault | Balancer, Balancer v3, Balancer v3 vault | vault | balancer-v3 | manager | `0x28082618ba2073e602230188e4f4c46e9b2169eb` | 0 | - | - | [Sourcify verified source](https://sourcify.dev/server/v2/contract/4663/0x28082618ba2073e602230188e4f4c46e9b2169eb) | served |
| ekubo | Ekubo | Ekubo, Ekubo Protocol, ekubo.org | vault | ekubo-core | manager | `0x00000000000014aa86c5d3c41765bb24e11bd701` | 33534 | - | - | [Ekubo robinhood deployment](https://github.com/EkuboProtocol/evm-contracts/blob/933c813ca154475a3c7eab8234869f6db151c682/broadcast/DeployAll.s.sol/4663/run-latest.json) | served |
| stock-token-market | unnamed stock-token market with one reserve holder | stock-token market, stock token market | vault | swapped-custody | manager | `0x2f4579ca81717d3d61bf8b6f06571877bbe54a07` | 461784 | - | - | [devops registry v29](https://github.com/chainswarm/devops/blob/e270ee1a3c8a2afc52e9d5549be5dbb8b98f0914/charts/chainswarm-indexer-evm-dex/registry/robinhood-v29.json) | served |
| ramses | Ramses | Ramses, Ramses Exchange, RAM, ramses.xyz, Ramses DLMM | plain | trader-joe-lb | factory | `0xdcd5f77697914e27f56fd263ef82923c8524abac` | 0 | 0x06ffaa507a9c3e7025294a642f1e1c75da3dfb4a | 150 | [Ramses contract addresses](https://www.ramses.xyz/docs/contract-addresses) | served |
| ramses | Ramses |  | plain | uniswap-v2 | factory | `0x43b2bf9f33036a02fc7a00935571c2a6b0108e66` | 0 | - | - | [Ramses contract addresses](https://www.ramses.xyz/docs/contract-addresses) | served |
| ramses | Ramses |  | plain | trader-joe-lb | router | `0xd0019e86edb35e1fedaab03aed5c3c60f115d28b` | 0 | - | - | [Ramses contract addresses](https://www.ramses.xyz/docs/contract-addresses) | served |
| sectorone | SectorOne | SectorOne, SectorOne DLMM | plain | trader-joe-lb | factory | `0x3d8dc63ddc9b992cfde89f7aea6f18717e84687d` | 0 | - | 30 | [DefiLlama traderJoeV2 registry](https://github.com/DefiLlama/DefiLlama-Adapters/blob/main/registries/traderJoeV2.js) | served |
| hoodit | Hoodit | Hoodit, hoodit.xyz | plain | trader-joe-lb | factory | `0x22602d966defd638ee94e97a92e2eb0934c3fe1b` | 0 | - | 5 | [DefiLlama traderJoeV2 registry](https://github.com/DefiLlama/DefiLlama-Adapters/blob/main/registries/traderJoeV2.js) | served |
| giga | GIGA | GIGA, GIGA DEX, GigaDEX, gigadex.fi | plain | uniswap-v2 | factory | `0x6fdf38f92ead1adfc04b73aaa947ab254f6c0916` | 0 | - | 15 | [HoodScan](https://hoodscan.co/project/giga) | served |
| flap | Flap | Flap, Flap launchpad, flap.sh | launchpad | uniswap-v2 | factory | `0x0d1ebb179cdbca88d74c923c4255cb2b17474afd` | 0 | - | 100000 | [HoodScan](https://hoodscan.co/project/flap) | served |
| curve | Curve | Curve, Curve Finance, CRV, curve.finance | plain | curve-stable | factory | `0x8271e06e5887fe5ba05234f5315c19f3ec90e8ad` | 0 | 0x7e0539140f16b3a8ed23ad69d6fea6a38fb8b299 | 25 | [curve-core deployments](https://github.com/curvefi/curve-core/blob/main/deployments/prod/robinhood.yaml) | served |
| metric | Metric | Metric, Metric OMM, metric.xyz | plain | metric-omm | factory | `0x2e0a99a2e352043d1ca489cf45bf7b511bccc738` | 0 | 0x584ac6010b095bf99398fae8203a3260a03d2b30 | 30 | [Metric SDK addresses](https://github.com/Metricxyz/sdk/blob/main/src/addresses.ts) | served |
| penguin | Penguin | Penguin, Penguin launchpad | launchpad | penguin-launchpad | factory | `0x09f1b640d53c9c4c1807bf5aa306745128ee4375` | 0 | - | - | [devops registry v24](https://github.com/chainswarm/devops/blob/de68f8676adac3e2f004fb0cd24c313f9516846e/charts/chainswarm-indexer-evm-dex/registry/robinhood-v24.json) | served |
| spcx | SPCX launchpad | SPCX, SPCX launchpad, spcx launchpad | launchpad | spcx-launchpad | factory | `0x3d6ea4e97b8ab9e1a1b4943febffe22d8c920091` | 0 | 0x1de3f839184cf48696cbb9cc283855eb32dc2c51 | 1 | [AP1000 change spcx-launchpad-adapter](https://github.com/chainswarm/AP1000/blob/main/openspec/changes/spcx-launchpad-adapter/design.md) | served |
| spcx | SPCX launchpad |  | launchpad | spcx-launchpad | router | `0x190b452d16e12e3beedd76a030ea991fe3856c33` | 0 | - | - | [AP1000 change spcx-launchpad-adapter](https://github.com/chainswarm/AP1000/blob/main/openspec/changes/spcx-launchpad-adapter/design.md) | served |
| spcx | SPCX launchpad |  | launchpad | spcx-launchpad-v2 | factory | `0x3d69104da2518f4833d71444d6611310f2d685f2` | 92760418 | - | - | [Sourcify LaunchFactory](https://sourcify.dev/server/v2/contract/4663/0x3d69104da2518f4833d71444d6611310f2d685f2) | served |
| spcx | SPCX launchpad |  | launchpad | spcx-launchpad-v2 | router | `0x3c7476e8be0efd5b9667421448a99e217b806e80` | 92651105 | - | - | [Sourcify LaunchRouter](https://sourcify.dev/server/v2/contract/4663/0x3c7476e8be0efd5b9667421448a99e217b806e80) | served |
| pons | pons | pons, pons launchpad | launchpad | bonding-curve | factory | `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e` | 0 | - | - | [pons deployment](https://github.com/DefiLlama/DefiLlama-Adapters/blob/main/projects/pons-v2/index.js) | served |
| eth-curve-launchpad | unnamed native-ETH bonding-curve launchpad | native-ETH bonding-curve launchpad, ETH bonding-curve launchpad | launchpad | hoodclub-curve | factory | `0xc4210279fb1e1de24a87d6f5cc597c9422aef899` | 54625631 | 0x01e7afb5fc124f6b8270bcd2b7d203dcad68c861 | 1 | [devops registry v29](https://github.com/chainswarm/devops/blob/e270ee1a3c8a2afc52e9d5549be5dbb8b98f0914/charts/chainswarm-indexer-evm-dex/registry/robinhood-v29.json) | served |
| single-router-launchpad | unnamed single-router bonding-curve launchpad | single-router bonding-curve launchpad, single-router launchpad | launchpad | mob-launch-curve | factory | `0x006fee8a9a5482dd7cdf7f21b4d78fa6e246ca4c` | 99903488 | - | - | [scout-agent finding 131](https://github.com/chainswarm/scout-agent/issues/131) | served |
| single-router-launchpad | unnamed single-router bonding-curve launchpad |  | launchpad | mob-launch-curve | manager | `0x4ed0f046d97d508df86d6b7b058e763dbfb0027f` | 99903488 | - | - | [devops registry v29](https://github.com/chainswarm/devops/blob/e270ee1a3c8a2afc52e9d5549be5dbb8b98f0914/charts/chainswarm-indexer-evm-dex/registry/robinhood-v29.json) | served |
| virtuals | Virtuals Protocol | Virtuals, VIRTUAL, Virtuals Protocol | launchpad | uniswap-v2 | factory | `0xfc2e4da3edb2e18100473339c763705d263d20a9` | 0 | - | - | [change silent-factory-discovery-and-labels](https://github.com/chainswarm/AP1000/blob/main/openspec/changes/archive/2026-10-16-silent-factory-discovery-and-labels/design.md) | served |
| weth-unwrap-helper | unnamed WETH-unwrap helper of Uniswap sell routes | WETH-unwrap helper | plain | uniswap-v3 | factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | 103295248 | - | - | [scout-agent finding 162](https://github.com/chainswarm/scout-agent/issues/162) | served |
| weth-unwrap-helper | unnamed WETH-unwrap helper of Uniswap sell routes |  | plain | uniswap-v3 | router | `0x0849c295bc609da9fde347834f92a75c2c4eb178` | 103295248 | - | - | [scout-agent finding 162](https://github.com/chainswarm/scout-agent/issues/162) | served |
| realm-etf | Realm ETF launchpad | Realm, Realm ETF, RealmEtf | launchpad | uniswap-v4 | factory | `0x124ad86c732b16366ed26445e3943adef635f123` | 101031051 | - | - | [Sourcify RealmEtfHook](https://sourcify.dev/server/v2/contract/4663/0x74dd0a05540f7c1ae419c18f8d55ff220076e8c8) | served |
| realm-etf | Realm ETF launchpad |  | launchpad | uniswap-v4 | router | `0x74dd0a05540f7c1ae419c18f8d55ff220076e8c8` | 101031057 | - | - | [Sourcify RealmEtfHook](https://sourcify.dev/server/v2/contract/4663/0x74dd0a05540f7c1ae419c18f8d55ff220076e8c8) | served |
| pangea | Pangea launch factory | Pangea, Pangea launch | launchpad | uniswap-v4 | factory | `0xadf9c12eaf14da2f7780c0587cc06034f1edf8d3` | 96290239 | - | - | [Sourcify UniswapLaunchFactoryV2](https://sourcify.dev/server/v2/contract/4663/0xadf9c12eaf14da2f7780c0587cc06034f1edf8d3) | served |
| pangea | Pangea launch factory |  | launchpad | uniswap-v4 | helper | `0x6ea418b883571af6155145d5604187f92b2d7b92` | 96283385 | - | - | [Sourcify PartsDeployerV2](https://sourcify.dev/server/v2/contract/4663/0x6ea418b883571af6155145d5604187f92b2d7b92) | served |
| icecreamswap | IceCreamSwap aggregator | IceCreamSwap, IceCream, Ice Cream Swap | plain | uniswap-v3 | factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | 3087983 | - | - | [Sourcify AggregatorGuard](https://sourcify.dev/server/v2/contract/4663/0x603206d6105217dd972e4ab30676a220ca393346) | served |
| icecreamswap | IceCreamSwap aggregator |  | plain | uniswap-v3 | router | `0x603206d6105217dd972e4ab30676a220ca393346` | 3087983 | - | - | [Sourcify AggregatorGuard](https://sourcify.dev/server/v2/contract/4663/0x603206d6105217dd972e4ab30676a220ca393346) | served |
| icecreamswap | IceCreamSwap aggregator |  | plain | uniswap-v3 | router | `0x2ca37ff95caf25366ef16fc2e655b78a165d125f` | 3094087 | - | - | [Sourcify AggregatorGuard](https://sourcify.dev/server/v2/contract/4663/0x603206d6105217dd972e4ab30676a220ca393346) | served |
| icecreamswap | IceCreamSwap aggregator |  | plain | uniswap-v3 | router | `0xec9aa0a6c2372131a0502aba6188269ab52cacb5` | 72179539 | - | - | [Sourcify AggregatorGuard](https://sourcify.dev/server/v2/contract/4663/0x603206d6105217dd972e4ab30676a220ca393346) | served |
| icecreamswap | IceCreamSwap aggregator |  | plain | uniswap-v3 | router | `0xe6eeda550918638529c6cf2ea14f9ea0572d6f88` | 92800751 | - | - | [Sourcify AggregatorGuard](https://sourcify.dev/server/v2/contract/4663/0x603206d6105217dd972e4ab30676a220ca393346) | served |
| per-launch-v4-router | unnamed per-launch Uniswap v4 swap routers | per-launch router, per-launch v4 router | vault | uniswap-v4 | manager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | 90471772 | - | - | [scout-agent finding 134](https://github.com/chainswarm/scout-agent/issues/134) | served |
| per-launch-v4-router | unnamed per-launch Uniswap v4 swap routers |  | vault | uniswap-v4 | helper | `0xe672754903b2be414abbec68ee1a6d7884ba993b` | 100454866 | - | - | [scout-agent finding 134](https://github.com/chainswarm/scout-agent/issues/134) | served |
| per-launch-v4-router | unnamed per-launch Uniswap v4 swap routers |  | vault | uniswap-v4 | helper | `0x0c388f9d803e17addc439a50a9c9b9e3937221f5` | 100437079 | - | - | [scout-agent finding 134](https://github.com/chainswarm/scout-agent/issues/134) | served |
| per-launch-v4-router | unnamed per-launch Uniswap v4 swap routers |  | vault | uniswap-v4 | helper | `0x3201074c2a813d9827c563395c16a86560f57437` | 100215518 | - | - | [scout-agent finding 134](https://github.com/chainswarm/scout-agent/issues/134) | served |
| per-launch-v4-router | unnamed per-launch Uniswap v4 swap routers |  | vault | uniswap-v4 | helper | `0x80d49714825e23d4801549a765cb88cf917f2f02` | 99533593 | - | - | [scout-agent finding 134](https://github.com/chainswarm/scout-agent/issues/134) | served |
| per-launch-v4-router | unnamed per-launch Uniswap v4 swap routers |  | vault | uniswap-v4 | helper | `0xf5b7cba51da2cef7fb334aa34c83203efa1f083e` | 99416107 | - | - | [scout-agent finding 134](https://github.com/chainswarm/scout-agent/issues/134) | served |
| per-launch-v4-router | unnamed per-launch Uniswap v4 swap routers |  | vault | uniswap-v4 | helper | `0xff4b110e9e3b70de24490bef682f18a2342b55a9` | 90471772 | - | - | [scout-agent finding 134](https://github.com/chainswarm/scout-agent/issues/134) | served |

## Verification

Read on lane A through the Chain Insights proxy on 2026-10-23, 14:10 to
14:25 CEST (`behind_dex` 419,493), and on lane B through the lane's MCP door
at 14:24 CEST. The census query and every number are in the evidence record
linked from the rows. A `factory` row shows the pools it created
(`DEPLOYED_CONTRACT`), a `manager` row the pools it holds, a `router` row the
swaps it forwarded.

| address | role | what the lane shows |
|---|---|---|
| `0xc63d7338c178e805c544b8f897066bd3bbcbe136` | factory | 70 `cl-gauge-v1` pools on lane A, 311,955,782 USD lifetime volume; deployed at block 93,973,839; the busiest pool `0x7615926023bb149f36095645c2a81dc367d39750` |
| `0x72e46c9edf828002fdbfdd0952419790576c0f18` | router | the `SWAPPED` recipient of 21 of the 23 biggest sellers into the pool above; a contract with no mark. Not in Aero's own deployment files, which name the metarouter and the CL swap router (both rows below it); kept as a router because the chain shows it forwarding Aero's swaps |
| `0xfa5429aeba338bea2bfcc1b9a889862ee395bc28` | factory | 67 `solidly-v2` pools on lane A, 31 on lane B (the lane is behind); 67,093,264 USD; deployed at block 6,180,950 |
| `0x1ac9db4a2608ba45d6127b1737949b51bb54b7f3` | factory | 1,918 `cl-gauge-v1` pools, 7,745,394,151 USD; deployed at block 6,184,096 by `0x85fb9f9bc8a44663a234adb4cfe4e1459c096651`, the deployer of up.'s solidly factory. DefiLlama's up-v3 adapter and 0x-settler name it as up.'s; its voter is up.'s Voter |
| `0x8366a39cc670b4001a1121b8f6a443a643e40951` | manager | `:Protocol`, marks `PoolManager` and `uniswap-v4`, 194,445,570,792 USD |
| `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | factory | 445,864 `uniswap-v3` pools; the busiest `0x10cc6bd38112cac182db90b6a71d8bb5939526ba`, 59,741,538,329 USD. The other registry anchor `0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865` created nothing |
| `0xd315a9c38ec871068fec378e4ce78af528c76293` | manager | `balancer-v2` custody, 2,320,921,692 USD; Swaap v2 per its docs, not Balancer |
| `0x28082618ba2073e602230188e4f4c46e9b2169eb` | manager | `balancer-v3` custody, registry anchor; Balancer v3 code per Sourcify, no exchange names it: served as the unnamed Balancer v3 vault |
| `0xd01c774d4a66408326bc65728ac5ae5aaf004032` | manager | `pancake-infinity-cl` custody; its reserve holder `0xfe7e25de55e5cbbecccb661f3679f873f72b9b0d` carries 617,619,030 USD. DefiLlama names this deployment Orvex; the indexer registry calls the stack `pancakeswap`. PancakeSwap's own Infinity is the stack `0xee04c68742e6bf434be8039580d2e89bbe55bc6f` and SushiSwap V4 is `0x81d732702f87d2d652ae79e9f52bf44928eca210`, both from their deployment files |
| `0x2e0a99a2e352043d1ca489cf45bf7b511bccc738` | factory | 82 `metric-omm` pools, 1,054,110,117 USD. The indexer registry anchors the adapter on `0x2a53833cc95548cf52c7b159110e22d3a9018f32`, which emits the creation events and created no pool itself; it has no row, because a factory row names the creator the graph links |
| `0x8271e06e5887fe5ba05234f5315c19f3ec90e8ad` | factory | 64 `curve-stable` pools, 171,763,477 USD |
| `0xdcd5f77697914e27f56fd263ef82923c8524abac`, `0x3d8dc63ddc9b992cfde89f7aea6f18717e84687d`, `0x22602d966defd638ee94e97a92e2eb0934c3fe1b` | factory | 257, 66 and 11 `trader-joe-lb` pools: Ramses DLMM, SectorOne and Hoodit, three Liquidity Book forks; Trader Joe itself has no deployment on this chain. `0xd60cf7876a1e7b8fcf963722a05039849fde5387` (11 pools) has no source and no row. The busiest traded `0x06ffaa507a9c3e7025294a642f1e1c75da3dfb4a` |
| `0x09f1b640d53c9c4c1807bf5aa306745128ee4375` | factory | created 48 contracts; none carries `:Pool` on lane A yet |
| `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e` | factory | 1,469,383 transactions on the contract itself; created 1 contract, no `:Pool` yet |
| `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f` | factory | 27,926 `uniswap-v2` pools, 10,573,207,859 USD. Uniswap's own v2 factory per its deployments page; Virtuals agents create most of its pairs, which is why the indexer registry stacks it as `virtuals`. The exchange row is `uniswap-v2`; `0xfc2e4da3edb2e18100473339c763705d263d20a9` is the Virtuals bonding factory per the Virtuals change |
| `0x3d6ea4e97b8ab9e1a1b4943febffe22d8c920091` | factory | read from the production node on 2026-10-25: its creation event names the launched token, its curve and the creator (sample transaction `0x77b1bcc700d5f1d7513d080d3fe265831529c237065fffed83e665f89cc3f019`, block 95,797,703); 2,182 curves, quoted in SPCX `0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea` and two other stock tokens. The example curve `0x1de3f839184cf48696cbb9cc283855eb32dc2c51` logged 1,028 trades in 7M blocks. No source names the operator, so the key stays `spcx` |
| `0x190b452d16e12e3beedd76a030ea991fe3856c33` | router | the SPCX legs of the sample trade `0xe200a831908a9b937e08eb4c16fdefd016f606980b9ef71f788994c76020708e` run trader, this contract, curve. The trader stays the payer: the router is never a swap end |
| `0x00000000000014aa86c5d3c41765bb24e11bd701` | manager | the Ekubo core, deployed at block 33,534 per Ekubo's robinhood deployment file. Read from the production node on 2026-10-25 over 20,000 blocks: 111 swaps and 65 position updates logged by the core itself, 28 pools initialized, each pool kept by a 32-byte pool id. Sample transaction `0x7926c9fab003029a42e7f398e3183611c49583a082b4aac781003cb43f5a96d9`, block 97,745,015 |
| `0x3d69104da2518f4833d71444d6611310f2d685f2` | factory | read on lane B's StarRocks on 2026-11-02: 827 `spcx-launchpad-v2` curves from block 92,760,418 (2026-10-19) to 104,473,613, each created by this contract. Sourcify verifies it as `LaunchFactory` from the same source path and compiler as the first SPCX factory, created at block 92,651,082 by `0xdaff80aadf44305fe95768de1aad1d8861c9f908`; the first was created by `0xb1748f1857bef8de020982aa33f6f9cc1b9ad3c1`, so the two share code, quote token and trade event, not a deployer. Its curve `0x94dc28d78ddbcfdffedb6825ba90b8c8c7b2ba65` (launch transaction `0x21302babf7065d3af00b755bb05bd0a29ea813f5f19767c4f675a74d420d0c6f`, block 100,172,602) holds 2,805 swap rows since 2026-10-28; the first, `0x7845d3a83929f66dce4bfac6e1ddcb7fc5a98f0b4f08b80f2008159100d1c128` at block 100,191,841, is a route through Uniswap v4 into the curve |
| `0x3c7476e8be0efd5b9667421448a99e217b806e80` | router | Sourcify `LaunchRouter`, created at block 92,651,105 by the factory's deployer. In `0x459b6eb7423b3f0f8cb2480a5968b55ffb7211af7efdff7ce64f33e6a3765bd7` (block 100,227,315) it takes the trader's USDG, buys SPCX on Uniswap v4 and pays the curve: the trader stays the payer |
| `0xc4210279fb1e1de24a87d6f5cc597c9422aef899` | factory | read on lane B's StarRocks on 2026-11-02: 570 `hoodclub-curve` curves from block 54,625,631 (2026-09-04) to 103,673,419; the factory created 1,710 contracts, a token, a curve and a fee vault per launch. Created at block 54,594,936 by `0xdef671f11c8a30818eb3d9cc9476eeec805f9058`; no source is verified and no project names it, so it is served as an unnamed launchpad. Its curves are paid and pay native ETH. The example curve `0x01e7afb5fc124f6b8270bcd2b7d203dcad68c861`, created with token `0x6966b6233f91790bebb1815a4d3acf55d82b3b49` in `0xb68bc059baa634df52a07570fe29dd61ac14cd6b346d8319edff0fc37feb40ea` (block 100,237,007, the creator's own buy), holds 290 swap rows since 2026-10-28 |
| `0x006fee8a9a5482dd7cdf7f21b4d78fa6e246ca4c` | factory | the token factory of the single-router launchpad: it created all 14 launched tokens on lane B, from Mob `0xe0165a1b3d8f9e276b0746adcb9c7094cbd05785` at block 99,903,488 to block 100,030,381. Created at block 99,884,248 by `0x9cd48fc444f80e6c79d90c4bcb9d045603747390`, the deployer of the router below. A launched token is not a pool: its curve is kept inside the router, so the row's factory serves the launches read, and the router holds the pools |
| `0x4ed0f046d97d508df86d6b7b058e763dbfb0027f` | manager | one router holds every curve, each keyed by the launched token: 13 `mob-launch-curve` pools on lane B on 2026-11-02, from block 99,903,488 to 100,025,977, and 780 swap rows since 2026-10-28. The first, `0x331d64719b7a01f59ef03311e4f0c10f00b7271d1cef0dcdeb6321ae480efcd7` at block 99,903,517, is a buy the router refunded in part. Created at block 99,884,296 by `0x9cd48fc444f80e6c79d90c4bcb9d045603747390`; no source is verified and no project names it. The token Mob is a launch, never the launchpad's name |
| `0x2f4579ca81717d3d61bf8b6f06571877bbe54a07` | manager | the one reserve holder of 105 market contracts that log `Swapped` and move no token themselves; the indexer names the first, `0x95e4a408590e5ace8aab498ab0f9f4236f5162e5` (the AMD market), and 104 more, all created by `0x8dbf0d37cad30b2510d5c74e0f87a210cb298086`. The holder takes the sold token and pays the bought one in every trade. Read on lane B's StarRocks on 2026-11-02: 52 `swapped-custody` pairs from block 461,784, each a pool of the holder keyed by its two tokens, and 225,885 swap rows from 2026-10-26 to 2026-11-02. On 2026-11-01 its trades were stock tokens (SNDK, SKHY, MU, MSTR, AMD, SPCX, USO, RDDT, DJT) against USDG, and some WETH and ETH; the first that day, `0x4e625db12c0affff1ab5634d587da84a0da4c474ab110d174b6c0cd6cd64887c` at block 102,958,054. Created at block 223,587 by `0xb97c121f7bf12bc21ed22b9739f3695bd2ab23a8`; no source is verified and no project names it. The market contracts have no row: each is one token's door, not a pool and not a router |
| `0x7a39b98d31f84152bc724bc5ddb41dbcb338f2a5` | router | read on the production graph through the Chain Insights proxy on 2026-11-05 by scout-agent (finding 164): a contract with no label, created at block 105,000,018 (2026-11-03) by `0xf90e3e4f5b23b2ba5a53e7c72ccac139e0ff1c1b` in `0x3561086bf317b231da030bff5367f6213afdeb01724f990c1d4dc2bbed06d982`, below the DEX head 106,440,927. About 500 wallets call it directly with ETH and USDG `0x5fc5360d0400a0fd4f2af552add042d716f1d168`: 500 senders, 495 receivers, 19,962 transactions in and 21,858 out. It wraps and unwraps WETH `0x0bd7d308f8e1639fab988df18a8011f41eacad73` and swaps in the Uniswap v3 WETH/USDG pool `0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca` (7,041 transactions) and, for some trades, the Uniswap v4 PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951`. Its `SWAPPED` links reach its callers through the pool, so the caller stays the trader. Sample call `0x4e675f9318bfced710a7c2072662701beb4662a6b61fcf57a608ac84fdbeae18` (block 106,301,475) from `0x7b6830c4f01d976d9a344febdf3588d99a23dfd0`, ETH value, 12 logs. No source is verified and no project names it |

`0x0d1ebb179cdbca88d74c923c4255cb2b17474afd` created 254,650 `uniswap-v2`
pairs with 38 USD of volume in all: the Flap launchpad's pair factory per
HoodScan, a launchpad row.

Exchange names were researched on 2026-10-23 from each exchange's own deployment
file where one exists (proven), else from DefiLlama, 0x-settler and HoodScan
(likely); the research note is in the evidence record. Sourcify covers chain
4663; the explorer's name tags were unreachable.

Registry version 2 (2026-10-24) moved the file from the private registry of
version 1 to this repository, renamed the key column `dex`, and gave `Balancer`
to the two Balancer vaults (`balancer-v3` and `swaap`), so a question that says
"Balancer" lists both instead of guessing one.

Registry version 3 (2026-10-25) serves the SPCX launchpad and Ekubo. Both
adapters (`spcx-launchpad`, `ekubo-core`) run on lane A and lane B from
indexer registry version 27, rolled at 21:42 CET. Their backfills were still
running at the flip, so neither exchange carries a pool floor yet.

Registry version 4 (2026-11-02) serves the four adapters of indexer registry
version 29 (interpreter `v1.61.0`), which runs on lane A and lane B:
`spcx-launchpad-v2` as a second factory and router of the SPCX launchpad,
and three exchanges no source names, each served under a plain description:
the native-ETH bonding-curve launchpad (`hoodclub-curve`), the single-router
bonding-curve launchpad (`mob-launch-curve`) and the stock-token market with
one reserve holder (`swapped-custody`). The adapter ids keep the indexer's
words: the indexer named `hoodclub` and `mob` after token symbols, and
neither is a cited exchange name. Only the native-ETH launchpad carries a pool floor; its count is the
lowest proven, one pool.

Registry version 5 (2026-11-05) serves the swap router of scout-agent
finding 164: an unnamed ETH/USDG router, `eth-usdg-router`, that about 500
wallets call directly and that swaps in Uniswap v3 and Uniswap v4 pools. No
source names its operator, so it is served under a plain description. The
review rule refuses an exchange with router rows only, so the key also
carries a factory row for the Uniswap v3 factory
`0x1f7d7550b1b028f7571e69a784071f0205fd2efa`, valid from the router's
creation block. The example pool is the pool the router swaps in, the
Uniswap v3 WETH/USDG pool `0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca`.
That factory stays Uniswap v3's: a lookup of its address still answers
Uniswap v3, the first exchange that names it.

Registry version 7 (2026-11-05) adds Uniswap's v2 router
`0x89e5db8b5aa49aa85ac63f691524311aeb649eba`. Sourcify verifies
`UniswapV2Router02`, and its `factory()` returns the Uniswap v2 factory
`0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f`. The scout digest of 2026-11-05
named it as a router with no exchange row.

Registry version 6 (2026-11-05) serves the rows of six scout-agent findings
and adds the role `helper`: a contract of an exchange that the trail does not
read. That is a position NFT, a gauge, a parts deployer, or a swap router of a
vault, where the manager stays the contract past the swap.

- Finding 162: the Uniswap Universal Routers
  `0x204faca1764b154221e35c0d20abb3c525710498` and
  `0x8876789976decbfcbbbe364623c63652db8c0904`, both on Uniswap's own
  Robinhood Chain list, and the WETH-unwrap contract
  `0x0849c295bc609da9fde347834f92a75c2c4eb178`. Its code holds WETH, and the
  graph shows 7,431 transfers from it to the first router. It has no verified
  source and no known operator, so it has a plain description and its own key.
- Finding 146: the Realm ETF launchpad. Sourcify verifies `RealmEtfHook`
  `0x74dd0a05540f7c1ae419c18f8d55ff220076e8c8`, and its code holds its factory
  `0x124ad86c732b16366ed26445e3943adef635f123` as an immutable.
- Finding 134: six single-launch v4 routers with one code shape, each holding
  the PoolManager in its code. No source names them. Later launches of the
  series need a row each.
- Finding 107: the Aero Slipstream staking contracts. Sourcify verifies the
  implementation `ArbCLGauge` `0x89e91a960154b1ed6c093039a8f0725ab67d14e0`. Both
  gauges read on 2026-11-05 answer `nft()` with the position NFT
  `0x4857db576ee0e45f10525ec59527bfd10beec60b` ("Slipstream V3 Deposit",
  AERO-CL) and `voter()` with `0x382409fad8503fbcdbb27a4211551fa03e884078`.
  `0xe033f4bd3d7ccf537a2f954ecdc8eb1218e3b7a6` answers `pool()` with the Aero
  pool `0x7615926023bb149f36095645c2a81dc367d39750`. Only the six gauges the
  finding names are listed, out of more than 50.
- Finding 100: the Pangea launch factory. Sourcify verifies
  `UniswapLaunchFactoryV2` `0xadf9c12eaf14da2f7780c0587cc06034f1edf8d3`, whose
  title names Pangea. Its code holds `PartsDeployerV2`
  `0x6ea418b883571af6155145d5604187f92b2d7b92`, and its `platform()` answers
  the 20 percent fee wallet `0xe8e219cccff046b8e6666f9803414f442e333940`.
- Finding 50: the IceCreamSwap aggregator. Sourcify verifies `AggregatorGuard`
  `0x603206d6105217dd972e4ab30676a220ca393346`, whose one entry function is
  named `IceCreamSwap`. The name rests on that function alone. The three
  executors are its routers.

Each new key that has no factory of its own names the factory or manager it
swaps through, valid from its own first block, as `eth-usdg-router` does. A
lookup of that factory or manager still answers Uniswap, the first exchange
that names it.
