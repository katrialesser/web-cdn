/**
 * Created by ThatJoeMoore on 1/25/17.
 */
"use strict";

const constants = require('./../constants');

const headers = {
    'User-Agent': constants.CDN.USER_AGENT
};

if (!process.env.GITHUB_USER || !process.env.GITHUB_TOKEN) {
    throw new Error('Need to provide a GITHUB_USER and GITHUB_TOKEN value!');
}
headers['Authorization'] = 'Basic ' + new Buffer(process.env.GITHUB_USER + ':' + process.env.GITHUB_TOKEN).toString('base64');

const req = require('request').defaults({
    headers: headers,
    json: true
});
const reqp = require('request-promise-native').defaults({
    headers: headers,
    json: true
});

module.exports = {
    request: {
        async: req,
        promise: reqp
    }
};

