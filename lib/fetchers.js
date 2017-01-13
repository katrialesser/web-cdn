/**
 * Created by jmooreoa on 1/5/17.
 */
const req = require('request').defaults({
    headers: {'User-Agent': 'BYU-Web-Community-CDN 1.0.0-dev'}
});
const reqp = require('request-promise-native').defaults({
    headers: {'User-Agent': 'BYU-Web-Community-CDN 1.0.0-dev'}
});
const fs = require('fs');


exports.GithubFetcher = class {
    constructor(source) {
        this.source = source;
        this._baseUrl = `https://api.github.com/repos/${source}`;
    }

    /**
     * @return Promise<string[]>
     */
    availableVersions() {
        let master = reqp(`${this._baseUrl}/branches/master`)
            .then(data => {
                let b = JSON.parse(data);
                return [{
                    name: 'unstable',
                    tag: 'master',
                    tarball: `${this._baseUrl}/tarball/master`,
                    git_sha: b.commit.sha
                }];
            });
        let tags = reqp(`${this._baseUrl}/tags`)
            .then(data => {
                let tags = JSON.parse(data);
                return tags.map(each => {
                    return {
                        name: unV(each.name),
                        tag: each.name,
                        tarball: each.tarball_url,
                        git_sha: each.commit.sha
                    };
                });
            });
        return Promise.all([master, tags]).then(results => {
            return [].concat(...results);
        });
    }

    fetchVersion(version, destination) {
        req.get(`${this._baseUrl}/`)
            .on('request', req => {

            }).pipe(fs.createWriteStream(destination, ''))

    }
};

function unV(str) {
    "use strict";
    if (str.toLowerCase().indexOf('v') === 0) {
        return str.substring(1);
    }
    return str;
}

