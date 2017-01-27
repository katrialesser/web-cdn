"use strict";

const CdnConfig = require('./lib/cdn-config');
const fsp = require('fs-extra-p');

/*
 * Steps:
 * - Load config
 * - Build Filesystem
 * - Push Filesystem
 */
CdnConfig.loadFromConfig({
    "demo-lib": {
        source: "github:ThatJoeMoore/byu-web-cdn-demo-lib"
    }
}).then(cfg => {
    console.log(cfg);
    return fsp.writeJson('./config.json', cfg);
}).catch(err => {
    console.error(err);
});
