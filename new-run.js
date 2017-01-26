"use strict";

const CdnConfig = require('./lib/cdn-config');
const fsp = require('fs-extra-p');

CdnConfig.loadFromConfig({
    "demo-lib": "github:ThatJoeMoore/byu-web-cdn-demo-lib"
})
    .then(cfg => {
        console.log(cfg);
        return fsp.writeJson('./config.json', cfg);
    })
    .catch(err => {
        console.error(err);
    });
