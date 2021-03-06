/*
Copyright 2020 Adobe
All Rights Reserved.

NOTICE: Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying
it. If you have received this file from a source other than Adobe,
then your use, modification, or distribution of it requires the prior
written permission of Adobe. 
*/
const https = require('https')

let _lrHost = process.env.LRHOST || 'lr.adobe.io' 

let _toJSON = (body) => {
	if (body.length == 0) {
		return // catch empty body to avoid an error in JSON parser
	}
	let decoder = new TextDecoder('utf-8')
	var string = decoder.decode(body)
	let while1Regex = /^while\s*\(\s*1\s*\)\s*{\s*}\s*/ // strip off while(1){}
	return JSON.parse(string.replace(while1Regex, ''))
}

let _onEnd = (res, body, resolve, reject) => {
	if (res.statusCode < 200 || res.statusCode > 299) {
		let decoder = new TextDecoder('utf-8')
		var string = decoder.decode(body)
		console.log("Error:"+string)
		reject({
			statusCode: res.statusCode,
			error: body
		})
	}
	else {
		resolve(res.headers['content-type'] == 'application/json' ? _toJSON(body) : body)
	}
}

let _requestP = (options, data) => new Promise((resolve, reject) => {
	https.request(options, (res) => {
		let chunks = []
		res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
		res.on('end', () => _onEnd(res, Buffer.concat(chunks), resolve, reject))
	}).on('error', reject).end(data)
})

let _unauthGetP = function(session, path) {
	let headers = {
		'X-API-Key': session.apiKey
	}
	let options = {
		method: 'GET',
		protocol: 'https:',
		host: session.host,
		port: session.port,
		path: path,
		headers: headers
	}
	return _requestP(options)
}

let _authRequestP = function(session, method, path, headers, data) {
	headers = Object.assign({}, headers)
	headers['X-API-Key'] = session.apiKey
	headers['Authorization'] = `Bearer ${session.accessToken}`
	let options = {
		method: method,
		protocol: 'https:',
		host: _lrHost,
		rejectUnauthorized: false,
		path: path,
		headers: headers
	}
	return _requestP(options, data)
}

let _getPagedP = async function(session, path, resources = []) {
	let res = await _authRequestP(session, 'GET', path, {})
	res.resources = resources.concat(res.resources)
	if (res.links && res.links.next) {
		let uri = `${res.base}${res.links.next.href}`
		let url = new URL(uri) // peel off the path of the fully formed uri
		return _getPagedP(session, url.pathname + url.search, res.resources)
	}
	return res
}

let _sendJSONP = function(session, method, path, json, sha256) {
	let data = JSON.stringify(json)
	let headers = {
		'Content-Type': 'application/json',
		'Content-Length': Buffer.byteLength(data)
	}
	if (sha256) {
		headers['If-None-Match'] = sha256
	}
	return _authRequestP(session, method, path, headers, data)
}

let _putChunkP = function(session, path, type, data, offset, size) {
	let length = Buffer.byteLength(data)
	let headers = {
		'Content-Type': type,
		'Content-Range': `bytes ${offset}-${offset + length - 1}/${size}`,
		'Content-Length': length
	}
	return _authRequestP(session, 'PUT', path, headers, data)
}

let LrRequestor = {
	healthP: (apiKey, host = _lrHost) => _unauthGetP({ apiKey, host }, '/v2/health'),
	getP: (session, path) => _authRequestP(session, 'GET', path, {}),
	getPagedP: (session, path) => _getPagedP(session, path),
	putP: (session, path, json) => _sendJSONP(session, 'PUT', path, json),
	putUniqueP: (session, path, json, sha256) => _sendJSONP(session, 'PUT', path, json, sha256),
	putChunkP: (session, path, type, data, offset, size) => _putChunkP(session, path, type, data, offset, size),
	postP: (session, path, json) => _sendJSONP(session, 'POST', path, json),
	deleteP: (session, path) => _authRequestP(session, 'DELETE', path, {})
}

module.exports = LrRequestor
