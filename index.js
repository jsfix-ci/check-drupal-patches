#!/usr/bin/env node
const { program } = require('commander');
const { execSync, spawnSync } = require("child_process");
const fs = require('fs');
const os = require('os');
const consola = require('consola');
const path = require('path');
const commandExistsSync = require('command-exists').sync;
const { exit } = require('process');

// The working directory has to be global, it's used in the error handler.
let workdir;

// Error handler.
process.on('uncaughtException', err => {
    if (workdir) {
        consola.info('Removing working directory...');
        fs.rmdirSync(workdir, { recursive: true });
    }
    consola.error(err.message);
    process.exit(1)
})

// Command handling.
let root = handleCommand();

// Check for needed CLI tools.
checkTools();

// Check root and get composer.json.
let json = preFlightCheck(root);

// Let's start the job by creating a temporary working directory.
workdir = createWorkDir();

// Add a modified composer.json without patch application.
json = addComposerJson(json);

// Install dependencies using Composer.
installDependencies();

// Get a list of the patches and add the package paths.
let patchList = getPatchList(json, root);

// Check the patches.
checkPatches(patchList);

// Done, cleanup things.
consola.info('Removing working directory...');
fs.rmdirSync(workdir, { recursive: true });
consola.success('Done!');
process.exit(0);

/**
 * Check the patches against the tagged releases
 * 
 * @param {*} patchList 
 */
function checkPatches(patchList) {
    consola.info('List of patched packages and patch files:');
    for (const [package, value] of Object.entries(patchList).sort()) {
        consola.info(`Checking patches for package ${package}...`);
        for (const item of value.patches) {
            checkPatch(package, item.description, item.patchfile, value.path);
        }
    }
}

/**
 * Check a single patch against a package.
 *
 * @param {*} description - the patch description
 * @param {*} patchfile - the absolute path to the patch file
 * @param {*} path - the absolute package location
 */
function checkPatch(package, description, patchfile, path) {
    // Enter the package folder
    const workdir = process.cwd();
    try {
        process.chdir(path);
    }
    catch {
        consola.warn(`Skipping patch for ${package}, package not found. Maybe the patch should be removed.`)
        return;
    }

    // Get the package version and a list of tags in the same branch.
    const version = getPackageVersion();
    consola.log('    Installed version: ' + version);
    const tags = getTags(version);
    consola.log('    Patch description: ' + description);
    // Check the patchfile against the related tags.
    for (const tag of tags) {
        switch (checkTag(tag, patchfile)) {
            case 1:
                consola.log('    - Patch has been applied to tag: ' + tag);
                break;
            case 0:
                consola.log('    - Patch is applicable for tag: ' + tag);
                break;
            default:
                consola.log('    - Patch is not applicable for tag: ' + tag);
                break;
        }
    }

    // Return to working directory
    process.chdir(workdir);
}

/**
 * Check a patch against a given tag / dependency release.
 *
 * @param {*} tag 
 * @param {*} patchfile 
 */
function checkTag(tag, patchfile) {
    // Checkout the tag.
    let result = execSyncSilent(`git checkout ${tag}`);
    if (result.error) {
        throw new Error(result.output);
    }
    // Check patch applicability.
    return patch(patchfile);

}

/**
 * Check a patch file against the current package.
 *
 * @param {*} patchfile - The patch file to be checked.
 */
function patch(patchfile) {

    let command;

    // Try the patch using all the possible patch levels.
    for (let level = 0; level < 5; level++) {
        // Check if the patch has been applied already.
        command = spawnSync('patch', [
            `-p${level}`,
            '-R',
            '--dry-run',
            '--no-backup-if-mismatch',
            '--silent',
            `--input=${patchfile}`
        ]);
        if (command.status === 0) { // Patch has been applied already.
            return 1;
        }
        // Check if the patch can be applied.
        command = spawnSync('patch', [
            `-p${level}`,
            '--dry-run',
            '--no-backup-if-mismatch',
            '--silent',
            `--input=${patchfile}`
        ]);
        if (command.status === 0) { // Patch is applicable.
            return 0;
        }
    }
    return -1; // Patch isn't applicable, or there was an error.
}

/**
 * Get the current version of a dependency.
 */
function getPackageVersion() {
    const result = execSyncSilent(`git tag --points-at`);
    if (result.error) {
        throw new Error(result.output);
    }
    return result.output.trim();
}

/**
 * Get the tags (releases) related to a given dependency version.
 *
 * @param {*} version 
 */
function getTags(version) {
    if (!version) {
        return [];
    }
    const prefix = version.substring(0, version.lastIndexOf('.'));
    const result = execSyncSilent(`git tag --sort=creatordate | grep ${prefix}`);
    if (result.error) {
        throw new Error(result.output);
    }
    const tags = result.output.match(/[^\r\n]+/g);
    return tags;
}

/**
 * Defines and handles the command.
 */
function handleCommand() {
    /* TODO: JSFIX could not patch the breaking change:
    TypeScript declaration for .addHelpText() callback no longer allows result of undefined, now just string 
    Suggested fix: Only breaking if the 2nd argument 'text' of addHelpText() might return undefined: The type of addHelpText() has been changed. To accommodate this return an appropriate string instead. */
    /* TODO: JSFIX could not patch the breaking change:
    [Deprecated] second parameter of cmd.description(desc, argDescriptions) for adding argument descriptions  
    Suggested fix: Passing a second argument to description is deprecated after 8.0.0. We suggest using the argument API (for example, new ...description('Checks Drupal patches managed by Composer against package releases').argument(name, description)), which is meant for declaring program arguments instead. */
    program
        .arguments('<root>')
        .description('Checks Drupal patches managed by Composer against package releases', {
            root: 'Drupal project root with composer.json',
        })
        .version(require('./package').version)
        .addHelpText('after', `
Usage example:
  $ cdp /var/www/drupal`);
    program.parse();
    let root = program.args[0];
    if (!root) {
        program.outputHelp();
        exit(1);
    }
    root = path.resolve(root);
    return root;
}

/**
 * Get a list of all patches and their meta information.
 *
 * @param {*} json - the applied composer.json file
 * @param string root - the Drupal project root directory
 */
function getPatchList(json, root) {
    const patches = json.extra.patches || require(root + '/' + json.extra['patches-file']).patches;
    const command = 'composer show -P -f json';
    const result = execSyncSilent(command);
    if (result.error) {
        throw new Error(result.output);
    }
    // Flatten the patch list
    let flat = {};
    for (const [package, value] of Object.entries(patches).sort()) {
        flat[package] = {
            "path": "",
            "patches": []
        };
        for (const [patch, file] of Object.entries(value)) {
            flat[package].patches.push({
                "description": patch,
                "patchfile": root + '/' + file,
            });
        }
    }
    // Add the paths.
    const paths = JSON.parse(result.output);
    for (const item of paths.installed) {
        if (flat[item.name]) {
            flat[item.name].path = item.path;
        }
    }
    return flat;
}

/**
 * Installs dependencies from source.
 */
function installDependencies() {
    consola.info('Installing dependencies from source, this will take quite some time...');
    const command = 'composer update --no-autoloader --no-scripts --prefer-source --ignore-platform-reqs';
    const result = execSyncSilent(command);
    if (result.error) {
        throw new Error(result.output);
    }
    consola.success('Dependencies installed successfully');
}

/**
 * Adds a modified composer.json to the working directory.
 *
 * @param {*} json - the original composer.json
 */
function addComposerJson(json) {
    // Remove patches plugin.
    delete json.require['cweagans/composer-patches'];
    fs.writeFileSync('composer.json', JSON.stringify(json));

    // Validate composer.json.
    const command = 'composer validate';
    const result = execSyncSilent(command);
    if (result.error) {
        throw new Error(result.output);
    }
    consola.success('composer.json is valid');
    return json;
}

/**
 * Creates and enters the working directory.
 */
function createWorkDir() {
    const directory = os.tmpdir() + '/cdp';
    fs.rmdirSync(directory, { recursive: true });
    fs.mkdirSync(directory);
    process.chdir(directory);
    return directory;
}

/**
 * Check project root and composer.json
 */
function preFlightCheck(root) {
    if (!fs.existsSync(root)) {
        throw new Error('Invalid project root');
    }
    consola.success('Found project root');
    if (!fs.existsSync(root + '/composer.json')) {
        throw new Error('composer.json not found in project root');
    }
    consola.success('Found composer.json');
    var json = fs.readFileSync(root + '/composer.json');
    try {
        json = JSON.parse(json);
    } catch (e) {
        throw new Error('composer.json is no valid json file ' + e);
    }
    consola.success('composer.json is a valid JSON file');
    if (!json.extra || (!json.extra.patches && !json.extra['patches-file'])) {
        throw new Error('composer.json does not list any patches');
    }
    consola.success('composer.json has a list of patches');
    return json;
}

/**
 * Check if the needed CLI tools are installed.
 */
function checkTools() {
    if (parseInt(process.versions.node.split('.')[0]) < 12) {
        throw new Error('NodeJS >= 12 is needed for execution');
    }
    if (!commandExistsSync('patch')) {
        throw new Error('Patch utility is needed for execution');
    }
    if (!commandExistsSync('git')) {
        throw new Error('Git is needed for execution');
    }
    if (!commandExistsSync('composer')) {
        throw new Error('Composer is needed for execution');
    }
}

/**
 * Execute CLI command synchronously.
 *
 * @param {*} command - the command to be executed
 */
function execSyncSilent(command) {
    try {
        return {
            "error": 0,
            "output": execSync(command, { stdio: ['pipe', 'pipe', 'pipe'] }).toString()
        }
    } catch (error) {
        return {
            "error": error.status,
            "output": error.toString(),
        };
    }
} 