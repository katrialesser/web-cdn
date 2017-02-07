/**
 * Created by ThatJoeMoore on 2/2/17
 */
"use strict";

const yaml = require('node-yaml');
const path = require('path');

const runner = require('../runner');

require('babel-polyfill');

/**
 *
 * @returns {Promise}
 */
exports.handler = function githubTrigger(event, context, callback) {
    //TODO: Add IP Validation
    console.log('Running build from Github Event', event);
    try {
        yaml.readPromise(path.join(process.cwd(), 'main-config.yml'))
            .then(libs => {
                console.log('Running with libs config', libs);
                return runner(libs)
            })
            .then(() => console.log('Finished run'))
            .then(() => callback(null, {done: true}))
            .catch(err => {
                console.error('Execution error', err, err.stack);
                callback(err)
            });
    } catch (err) {
        console.error('error', err);
        callback(err);
    }
    console.log('fired up promises');
};