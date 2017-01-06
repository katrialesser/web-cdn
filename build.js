#!/usr/bin/env node

const yaml = require('node-yaml');
const path = require('path');
const fs = require('fs');
const fetcherDefs = require('./lib/fetchers.js');

const config = yaml.readSync('config.yml');

const libs = Object.getOwnPropertyNames(config);

let fetchers = libs.reduce((obj, lib) => {
    let source = config[lib].source;

    let parts = source.split(':', 2);
    if (parts.length !== 2) {
        throw `Invalid source: ${source}`;
    }
    let sourceType = parts[0];
    let sourceLocation = parts[1];
    switch (sourceType) {
        case 'github':
            obj[lib] = new fetcherDefs.GithubFetcher(sourceLocation);
            break;
        default:
            throw `Unrecognized source type: ${sourceType}`;
    }
    return obj;
}, {});

console.log(fetchers);


