#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const parentPath = path.join(__dirname, "..");

const eigenlayerDeploymentOutputPath = path.join(
  parentPath,
  "avs/script/output/31337/eigenlayer_deployment_output.json"
);
const avsDeploymentOutputPath = path.join(
  parentPath,
  "avs/script/output/31337/unicow_avs_deployment_output.json"
);
const hookDeploymentOutputPath = path.join(
  parentPath,
  "hook/script/output/31337/unicow_hook_deployment_output.json"
);

const eigenlayerDeploymentOutput = JSON.parse(
  fs.readFileSync(eigenlayerDeploymentOutputPath, "utf8")
);
const avsDeploymentOutput = JSON.parse(
  fs.readFileSync(avsDeploymentOutputPath, "utf8")
);
const hookDeploymentOutput = JSON.parse(
  fs.readFileSync(hookDeploymentOutputPath, "utf8")
);

const consolidatedOutput = {
  eigenlayer: {
    ...eigenlayerDeploymentOutput.addresses,
  },
  avs: {
    ...avsDeploymentOutput.addresses,
  },
  hook: {
    ...hookDeploymentOutput.addresses,
  },
};

fs.writeFileSync(
  path.join(parentPath, "deployment_addresses.json"),
  JSON.stringify(consolidatedOutput, null, 2)
);
