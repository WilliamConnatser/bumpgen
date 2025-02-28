#!/usr/bin/env node
import React from "react";
import { Option, program } from "@commander-js/extra-typings";
import { select } from "@inquirer/prompts";
import { render } from "ink";
import { serializeError } from "serialize-error";

import {
  makeBumpFinder,
  makeBumpgen,
  SupportedLanguages,
  SupportedModels,
} from "@xeol/bumpgen-core";

import App from "./App";

const command = program
  .name("bumpgen")
  .description("Upgrade packages with the help of AI")
  .version("0.0.1")
  .argument("[package]", "name of the package to bump")
  .argument("[version]", "upgrade to this version of the package")
  .addOption(
    new Option("-l, --language <language>", "the language of the project")
      .choices(SupportedLanguages)
      .default("typescript" as const),
  )
  .addOption(
    new Option("-m, --model <model>", "the model to use for the upgrade")
      .choices(SupportedModels)
      .default("o1-preview" as const),
  )
  .option(
    "-t, --token <token>",
    "LLM token (can also be set via the LLM_API_KEY environment variable)",
  )
  .option(
    "-p, --port <port>",
    "port to run the IPC server on",
    (val) => parseInt(val),
    3000,
  )
  .option("-n, --no-upgrade", "skip applying the upgrade")
  .option(
    "-a, --auto-detect [branch]",
    "auto-detect the package to upgrade, diff against [branch]",
  )
  .option("-s, --simple", "simple mode")
  .option("-i, --ipc", "run in ipc mode")
  .option("-d, --dir <dir>", "target directory for the upgrade")
  .parse();

const { model, language, port, ipc, simple, token, upgrade, dir, autoDetect } =
  command.opts();

let [pkg, version] = command.processedArgs;

if (isNaN(port)) {
  console.log("Port must be a number");
  process.exit(1);
}

const resolvedToken = token ?? process.env.LLM_API_KEY;

if (!resolvedToken) {
  console.log(
    "LLM token must be provided (either via --token or the LLM_API_KEY environment variable)",
  );
  process.exit(1);
}

const bumpFinder = makeBumpFinder({
  language,
  projectRoot: dir,
});

const available = await bumpFinder.list();

if (!pkg) {
  if (autoDetect) {
    const detected = await bumpFinder.detect(
      autoDetect === true ? undefined : autoDetect,
    );

    if (detected.length > 0) {
      if (detected.length > 1) {
        console.error("Multiple package changes detected");
        detected.forEach((p) =>
          console.log(`${p.packageName}@${p.newVersion}`),
        );
        process.exit(1);
      }

      pkg = detected[0]!.packageName;
      version = detected[0]!.newVersion;
    } else {
      console.log("No package changes detected");
      process.exit(0);
    }
  } else {
    if (available.length === 0) {
      console.log("All packages are on their latest major version!");
      process.exit(0);
    }

    console.log("Using model:", model);

    const choice = await select({
      message: "Select a package to upgrade (major version changes only)",
      choices: available.map((pkg, index) => {
        return {
          name: `${pkg.packageName}@${pkg.newVersion}`,
          value: index,
        };
      }),
    });

    pkg = available[choice]!.packageName;
    version = available[choice]!.newVersion;
  }
}

if (!version) {
  const choice = available.find((p) => p.packageName === pkg);

  if (!choice) {
    console.log(
      `Package ${pkg} is not currently in your project, or is already on its latest major version`,
    );
    process.exit(1);
  }
  version = choice.newVersion;
}

const bumpgen = makeBumpgen({
  llmApiKey: resolvedToken,
  model,
  packageToUpgrade: {
    packageName: pkg,
    newVersion: version,
  },
  language,
  projectRoot: dir,
});

if (simple) {
  for await (const event of bumpgen.execute({
    upgrade,
  })) {
    console.log("event", event);
  }
} else if (ipc) {
  console.log("Running in IPC mode");

  for await (const event of bumpgen.executeSerializeable({
    upgrade,
  })) {
    console.log("event", event);
    try {
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      };
      await fetch(`http://localhost:${port}/data`, options);
    } catch (error) {
      console.log("error", serializeError(error));
      process.exit(1);
    }
    if (event.type === "error") {
      process.exit(1);
    }
  }
} else {
  const app = render(
    <App
      model={model}
      language={language}
      pkg={pkg}
      version={version}
      token={token}
      port={port}
      upgrade={upgrade}
      dir={dir}
    />,
  );
  await app.waitUntilExit();
}
