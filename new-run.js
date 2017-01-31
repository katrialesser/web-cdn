"use strict";

const CdnConfig = require('./lib/cdn-config');
const fsp = require('fs-extra-p');
const path = require('path');
const buildFilesystem = require('./lib/build-filesystem');
const commitContent = require('./lib/commit-content');

const SCRATCH_DIR_NAME = '.tmp';

const scratchPath = path.join(process.cwd(), SCRATCH_DIR_NAME);
const contentPath = path.join(scratchPath, 'content');
const workPath = path.join(scratchPath, 'work');


/*
 * Steps:
 * - Load config
 * - Build Filesystem
 * - Push Filesystem
 */
let configPromise =
// CdnConfig.loadFromConfig({
//     "demo-lib": {
//         source: "github:ThatJoeMoore/byu-web-cdn-demo-lib"
//     }
// });
    fsp.readJson('config.json').then(cfg =>
        new CdnConfig(cfg.libs, cfg.contentInfo)
    );


configPromise.then(cfg => {
    console.log(cfg);
    return fsp.writeJson('./config.json', cfg)
        .then(() => cfg);
}).then(cfg => {
    return buildFilesystem(cfg, contentPath, workPath)
        .then(() => commitContent(cfg, contentPath));
}).catch(err => {
    console.error(err);
});
