const express = require('express')
const router = express.Router()
const request = require('request-promise');
const bodyParser = require('body-parser');
const LrContext = require('../lr/LrContext')
const LrSession = require('../lr/LrSession')
const LrUtils = require('../lr/LrUtils')
router.use(bodyParser.raw({limit: '200mb'})) // middleware for uploading binaries

const dref = LrUtils.dref

const asyncWrap = fn =>
	function asyncUtilWrap (req, res, next, ...args) {
    	const fnReturn = fn(req, res, next, ...args)
    	return Promise.resolve(fnReturn).catch(next)
}

let baseUrl = process.env.BASEURL || `https://${process.env.HOST}:${process.env.PORT}`
let scope = process.env.SCOPE || "openid,lr_partner_apis"

const getContext = async (req, res, next) => {
	// if we don't have a token, use ims redirect to login and get one
	if (!process.env.TOKEN) {
		res.redirect(`https://ims-na1.adobelogin.com/ims/authorize?client_id=${process.env.KEY}&scope=${scope}&response_type=code&redirect_uri=${baseUrl}/callback?redirect_uri=${baseUrl}${req.originalUrl}`)
		return null
	}
	// we have a token, if we don't have a session yet, create one
	if (!req.session.lrSession ) {
		req.session.lrSession =  await LrSession.currentP()
	}
	// context can't be stored in session, so create one using session data
	return new LrContext(req.session.lrSession)
}

// handle callback from oath site with redirect to original URL
router.get('/callback', asyncWrap( function(req, res, next) {
	// Retrieve authorization code from request
	let code = req.query.code;
	// passing a redirect_uri inside the auth redirect_uri allows continuing an operation after login
	let redirect_uri = req.query.redirect_uri
	let requestOptions = {
        uri: `https://ims-na1.adobelogin.com/ims/token?grant_type=authorization_code&client_id=${process.env.KEY}&client_secret=${process.env.SECRET}&code=${code}`,
        method: 'POST',
        json: true
	}
	//Send a POST request using the request library 
	request(requestOptions)
		.then(async (response) => {
			// stash our token dynamically in the env environment
			process.env.TOKEN = response.access_token;
			if (redirect_uri) {
				res.redirect( redirect_uri )
			} else {
				res.status(200);
			}
    	})
    	.catch(function (error) {
			res.status(401);
    	});
}))


const getAlbumsList = async (lr) => {
	let albums = await lr.getAlbumsP('project_set%3Bproject')
	let albumsList = []

	albums.forEach((album) => {
		let name = dref(album,'payload','name')
		albumsList.push({
			id: album.id,
			name: name,
		})
	})
	return albumsList
}

const getAlbumData = async (lr, album) => {
	let name = dref(album,'payload','name')
	let albumData = {
		id: album.id,
		name: name,
		assets: []
	}
	let albumAssets = await lr.getAlbumAssetsP(album.id)
	albumAssets.forEach((albumAsset) => {
		let assetId = albumAsset.asset.id
		let fileName =  dref(albumAsset,'asset','payload','importSource','fileName')
		let remoteId =  dref(albumAsset,'payload','publishInfo','remoteId')
		albumData.assets.push({
			id: assetId,
			name: fileName,
			width: dref(albumAsset,'payload','develop','croppedWidth'),
			height: dref(albumAsset,'payload','develop','croppedHeight'),
			thumb: "thumb/"+assetId,
			img: "img/"+assetId
		})
	})
	return albumData
}


const updateAlbum = async (lr, album) => {
	let payload =  dref(album, 'payload' )
	let publishInfo = dref(album, 'payload','publishInfo')
	let remoteLinks = dref(album, 'payload','publishInfo','remoteLinks' )
	
	let updateTimestamp = (new Date()).toISOString()
	if (!dref(album, 'payload','publishInfo','created')) {
		publishInfo.created = updateTimestamp
	}
	publishInfo.updated = updateTimestamp
	publishInfo.remoteLinks = {
		view: { 
			href: `${baseUrl}/view?project_id=${album.id}` 
		}
	}
	// can't call this until the apis are updated to support POST
	if (process.env.SCOPE) { // allow if scope is overridden
		let result = await lr.updateAlbumP(album.id, 'project', payload)
	}
}

const showAlbumView = async ( req, res, next, albumId) => {
	let lr = await getContext(req, res)
	if (lr) {
		let albums = await getAlbumsList(lr)
		albumId = albumId || albums[0].id
		let album = await lr.getAlbumP( albumId )
		let albumData = await getAlbumData(lr, album)
		res.render('album', { albums: albums, album: albumData, response: JSON.stringify(albumData, null, 2) })
	}
}

router.get('/', asyncWrap( async (req, res, next) => {
	await showAlbumView(req, res, next)
}))

// handles project create and resend from lightroom desktop
router.get('/redirect', asyncWrap( async (req, res) => {
	let lr = await getContext(req, res)
	if (lr) {
		let album = await lr.getAlbumP(req.query.project_id)
		await updateAlbum(lr, album)
		let response = await getAlbumData(lr, album)
		let albums = await getAlbumsList(lr)
		res.render('album', { albums: albums, album: response, response: JSON.stringify(response, null, 2) })
	}
	}))

router.get('/view', asyncWrap( async (req, res, next) => {
	await showAlbumView(req, res, next, req.query.project_id)
}))

router.get('/thumb/:assetId', asyncWrap( async (req, res) => {
	let lr = await getContext(req, res)
	if (lr) {
		let assetId = req.params.assetId
		let thumb = await lr.getAssetThumbnailRenditionP(assetId)
		res.contentType('image/jpeg');
		res.send(thumb);
	}
}))

// won't work in lrD from localhost (see notes on config route)
router.get('/learn', (req, res, next) => {
	res.render('learn');
})

// dynamically generated configuration example for Lightroom desktop
// insert full url to this route in the desktip config.lua - Connections = { "https://myserver.com/config" }
// Note: this won't work from localhost because lrD requires https with known CA certificates
router.get('/config', (req, res, next) => {
	let locale = req.query.locale  // requested language
	res.json( {
		"status": "prod",
		"serviceId": `${process.env.KEY}`,
		"urlId":  "ctst",
		"name":  "Connection Test",
		"title": "Connection Test",
		"description" : "Testing Lightroom connections from localhost",
		"learnHref" : `${baseUrl}/learn`,
		"siteHref" : `${baseUrl}`,
		"redirectHref":`${baseUrl}/redirect`,
		"iconHref" : `${baseUrl}/icon.png`
	})
})

module.exports = router
