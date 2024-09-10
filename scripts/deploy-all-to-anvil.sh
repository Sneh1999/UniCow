#!/bin/bash

RPC_URL=http://localhost:8545
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

parent_path=$(cd "$(dirname "${BASH_SOURCE[0]}")"; pwd -P)
cd "$parent_path"

set -a; source ./utils.sh; set +a

cleanup() {
    echo "Executing cleanup function..."
    set +e
    docker rm -f anvil
    exit_status=$?
    if [ $exit_status -ne 0 ]; then
        echo "Script exited due to set -e on line $1 with command '$2'. Exit status: $exit_status"
    fi
}
trap 'cleanup $LINENO "$BASH_COMMAND"' EXIT

start_anvil_docker "" $parent_path/fixtures/anvil-state.json

# deploying eigenlayer contracts
cd ../avs/lib/eigenlayer-middleware/lib/eigenlayer-contracts
mv script/output/devnet/M2_from_scratch_deployment_data.json script/output/devnet/M2_from_scratch_deployment_data.json.bak
forge script script/deploy/devnet/M2_Deploy_From_Scratch.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast --sig "run(string memory configFile)" -- M2_deploy_from_scratch.anvil.config.json
mv script/output/devnet/M2_from_scratch_deployment_data.json ../../../../script/output/31337/eigenlayer_deployment_output.json
mv script/output/devnet/M2_from_scratch_deployment_data.json.bak script/output/devnet/M2_from_scratch_deployment_data.json

# deploying AVS contracts
cd $parent_path
cd ../avs
forge script script/AVSDeployer.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast --sig "run()"

SERVICE_MANAGER_PROXY_ADDRESS=$(cat script/output/31337/unicow_avs_deployment_output.json | jq -r '.addresses.serviceManagerProxy')

# deploying hook contracts
cd $parent_path
cd ../hook
forge clean
forge script script/HookDeployer.s.sol --private-key $PRIVATE_KEY -vvvvv --broadcast --sig "run(address serviceManager)" -- $SERVICE_MANAGER_PROXY_ADDRESS

HOOK_ADDRESS=$(cat script/output/31337/unicow_hook_deployment_output.json | jq -r '.addresses.hook')

# set hook address in AVS service manager
cast send --private-key $PRIVATE_KEY --gas-limit 1000000 $SERVICE_MANAGER_PROXY_ADDRESS "setHook(address)" $HOOK_ADDRESS

# consolidate output addresses
cd $parent_path
node ./consolidate-output-addresses.js