/*
Copyright 2020 Adobe
All Rights Reserved.

NOTICE: Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying
it. If you have received this file from a source other than Adobe,
then your use, modification, or distribution of it requires the prior
written permission of Adobe. 
*/
const LrRequestor = require('./LrRequestor')
const crypto = require('crypto')

function _createUuid() {
	// helper function for generating a Lightroom unique identifier
	let bytes = crypto.randomBytes(16)
	bytes[6] = bytes[6] & 0x0f | 0x40
	bytes[8] = bytes[8] & 0x3f | 0x80
	return bytes.toString('hex')
}

class LrContext {
	constructor(session, account, catalog) {
		account = account || session.account
		catalog = catalog || session.catalog
		this.account = account
		this.catalog = catalog
		this.chunkSize = 20 * 1024 * 1024 // minimum chunk size of 32K except last one

		this._session = session
		this._accountId = account.id
		this._catalogId = catalog.id
	}

	getHealthP() {
		return LrRequestor.healthP(this._session.apiKey)
	}

	getAccountP() {
		let path = `/v2/account`
		return LrRequestor.getP(this._session, path)
	}

	getCatalogP() {
		let path = `/v2/catalog`
		return LrRequestor.getP(this._session, path)
	}

	getFirstAssetP() {
		let path = `/v2/catalogs/${this._catalogId}/assets?subtype=image%3Bvideo&limit=1`
		return LrRequestor.getP(this._session, path)
	}

	getAssetP(assetId) {
		let path = `/v2/catalogs/${this._catalogId}/assets/${assetId}`
		return LrRequestor.getP(this._session, path)
	}

	getIncompletesP() {
		let path = `/v2/catalogs/${this._catalogId}/assets?subtype=image%3Bvideo&exclude=complete`
		return LrRequestor.getPagedP(this._session, path)
	}

	async getAssetThumbnailRenditionP(assetId) {
		let path = `/v2/catalogs/${this._catalogId}/assets/${assetId}/renditions/thumbnail2x`
		return LrRequestor.getP(this._session, path)
	}

	async getAsset2048RenditionP(assetId) {
		let path = `/v2/catalogs/${this._catalogId}/assets/${assetId}/renditions/2048`
		return LrRequestor.getP(this._session, path)
	}

	async createRevisionP(subtype, name, size, sha256) {
		let assetId = _createUuid()
		let revisionId = _createUuid()
		let path = `/v2/catalogs/${this._catalogId}/assets/${assetId}/revisions/${revisionId}`
		let importTimestamp = (new Date()).toISOString()
		let content = {
			subtype: subtype,
			payload: {
				captureDate: '0000-00-00T00:00:00',
				userCreated: importTimestamp,
				userUpdated: importTimestamp,
				importSource: {
					fileName: name,
					importTimestamp: importTimestamp,
					importedBy: this._accountId,
					importedOnDevice: this._session.apiKey
				}
			}
		}
		if (subtype == 'video') {
			content.payload.importSource.contentType = 'video/*'
			if (size) {
				content.payload.importSource.fileSize = size
			}
			if (sha256) {
				content.payload.importSource.sha256 = sha256
			}
		}
		await LrRequestor.putUniqueP(this._session, path, content, sha256) // 412 error if duplicate revision
		return {
			id: assetId,
			master_create: `${path}/master`
		}
	}

	getAlbumsP(subtype) {
		let path = `/v2/catalogs/${this._catalogId}/albums?subtype=${subtype}`
		return LrRequestor.getPagedP(this._session, path).then((response) => response.resources)
	}

	getAlbumP(albumId) {
		let path = `/v2/catalogs/${this._catalogId}/albums/${albumId}`
		return LrRequestor.getP(this._session, path)
	}

	async getFirstAlbumAssetP(albumId) {
		let path = `/v2/catalogs/${this._catalogId}/albums/${albumId}/assets?subtype=image%3Bvideo&embed=asset&order_after=-&limit=1`
		let response = await LrRequestor.getP(this._session, path)
		return response.resources[0]
	}

	getAlbumAssetsP(albumId) {
		let path = `/v2/catalogs/${this._catalogId}/albums/${albumId}/assets?subtype=image%3Bvideo&embed=asset&order_after=-`
		return LrRequestor.getPagedP(this._session, path).then(response => response.resources)
	}

	async getAlbumCoverP(album) {
		if (album.links['/rels/cover_asset']) {
			let assetId = album.links['/rels/cover_asset'].href.match(/assets\/([a-f0-9]{32})\/?/)[1]
			return this.getAssetThumbnailRenditionP(assetId)
		}
	}

	async createAlbumP (subtype, name, parentId, remoteId) {
		let albumId = _createUuid()
		let path = `/v2/catalogs/${this._catalogId}/albums/${albumId}`
		let importTimestamp = (new Date()).toISOString()
		let content = {
			subtype: subtype,
			serviceId: this._session.apiKey,
			payload: {
				userCreated: importTimestamp,
				userUpdated: importTimestamp,
				name: name
			}
		}
		if (parentId) {
			content.payload.parent = {
				id: parentId
			}
		}
		if (remoteId) {
			content.payload.publishInfo = {
				version: 3,
				created: importTimestamp,
				updated: importTimestamp,
				remoteId: remoteId
			}
		}
		await LrRequestor.putP(this._session, path, content)
		return albumId
	}

	async updateAlbumP ( albumId, subtype, payload ) {
		let path = `/v2/catalogs/${this._catalogId}/albums/${albumId}`
		let updateTimestamp = (new Date()).toISOString()
		payload.userUpdated = updateTimestamp
		let content = {
			_id: albumId,
			//subtype: subtype,
			//serviceId: this._session.apiKey,
			payload: payload 
		}
		await LrRequestor.postP(this._session, path, content)
		return albumId
	}

	async deleteAlbumP ( albumId ) {
		let path = `/v2/catalogs/${this._catalogId}/albums/${albumId}`
		LrRequestor.deleteP(this._session, path)
	}

	putMasterP(path, mime, offset, size, data) {
		console.log(`Received ${data.length} bytes of data at ${offset}`)
		return LrRequestor.putChunkP(this._session, path, mime, data, offset, size)
	}

	async addAssetsToAlbumP(albumId, assets) {
		// assets is an array of { id: assetId, remoteId: remoteId }
		let albumAssets = assets.map((asset) => {
			let resource = {
				id: asset.id
			}
			if (asset.remoteId) {
				let importTimestamp = (new Date()).toISOString()
				resource.payload = {
					userCreated: importTimestamp,
					userUpdated: importTimestamp,
					publishInfo: {
						remoteId: asset.remoteId
					}
				}
			}
			return resource
		})
		let path = `/v2/catalogs/${this._catalogId}/albums/${albumId}/assets`
		for (let len = albumAssets.length, i = 0; i < len; i += 50) { // maximum chunk size of 50
			let content = { resources: albumAssets.slice(i, i + 50) }
			let count = content.resources.length
			try {
				await LrRequestor.putP(this._session, path, content)
			} catch (err) {
				if (err.statusCode != 403) {
					throw err
				}
				// recover from error where all assets are already in the album; treat as success
				let response = err.error
				if (count != response.errors.filter((error) => error.subtype == 'ResourceExistsError').length) {
					throw err
				}
				console.log('add assets: all assets in chunk are already in album')
			}
		}
	}
}

module.exports = LrContext
