#!/usr/bin/env node
"use strict";

const yaml = require('node-yaml');
const path = require('path');
const fs = require('fs');
const semver = require('semver');
const fetcherDefs = require('./lib/fetchers.js');

const config = yaml.readSync('main-config.yml');

const libs = Object.getOwnPropertyNames(config);

const dataSetOps = {};

dataSetOps.forEach = function (fun) {
    libs.forEach(each => {
        fun(this[each]);
    });
};

dataSetOps.map = function (fun) {
    return libs.map(each => {
        return fun(this[each]);
    });
};

dataSetOps.promiseAll = function(fun) {
    return Promise.all(
        this.map(each => {
            return Promise.resolve(fun(each));
        })
    ).then(() => {
        return this;
    });
};

//The core logic of this build is promise-based.  Each function should take in and resolve the complete data set.
createDataSet()
    .then(populateVersions)
    .then(computeAliases)
    .then(ds => {
        console.log(JSON.stringify(ds, null, 2));
    }, error => {
        console.error(error);
    })
;

function createDataSet() {
    return Promise.resolve(libs.reduce((obj, lib) => {
        let source = config[lib].source;
        obj[lib] = {
            source: source,
            versions: [],
            aliases: {},
            fetcher: fetcherFor(source)
        };
        return obj;
    }, Object.create(dataSetOps, {})));
}

function fetcherFor(source) {
    let parts = source.split(':', 2);
    if (parts.length !== 2) {
        throw `Invalid source: ${source}`;
    }
    let sourceType = parts[0];
    let sourceLocation = parts[1];
    switch (sourceType) {
        case 'github':
            return new fetcherDefs.GithubFetcher(sourceLocation);
            break;
        default:
            throw `Unrecognized source type: ${sourceType}`;
    }
}

function populateVersions(dataSet) {
    return dataSet.promiseAll(lib => {
        return lib.fetcher.availableVersions()
            .then(vers => {
                lib.versions = vers;
            });
    });
}

function computeAliases(dataSet) {
    return dataSet.promiseAll(lib => {
        let verNums = lib.versions.map(each => each.name).filter(semver.valid);
        let desired = computeDesiredAliases(verNums);
        lib.aliases = [...desired].reduce((obj, alias) => {
            obj[alias] = semver.maxSatisfying(verNums, alias);
            return obj;
        }, {});
    });

    function computeDesiredAliases(versionNames) {
       return versionNames.reduce((set, each) => {
           let major = semver.major(each);
           let minor = semver.minor(each);
           set.add(`${major}`);
           set.add(`${major}.${minor}`);
           return set;
       }, new Set());
    }
}


