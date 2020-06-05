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

let UserData = {
	_users: {},

	get: function(accountId) {
		return UserData._users[accountId]
	},

	set: function(sessionData) {
		let account = sessionData.account
		let user = {
			timestamp: (new Date()).toISOString(), // when this user data was updated
			sessionData: sessionData,
			account_id: account.id,
			catalog_id: sessionData.id,
			full_name: account.full_name,
			email: account.email,
			status: account.entitlement.status,
			storage_used: account.entitlement.storage.used,
			storage_limit: account.entitlement.storage.limit
		}
		return UserData._users[account.id] = user
	}
}

// if not logged in, then perform Oath redirect sequence
router.use((req, res, next) => {
	if (!req.session.lrSession && req.path != "/callback") {
		console.log(`login redirect for +${req.originalUrl}`)
		res.redirect(`https://ims-na1.adobelogin.com/ims/authorize?client_id=${process.env.KEY}&scope=openid, lr_partner_apis&response_type=code&redirect_uri=https://localhost:8000/callback?redirect_uri=https://localhost:8000${req.originalUrl}`)
	} else {
		next()
	}
});	
  
// handle callback from oath site with redirect to original URL
router.get('/callback', asyncWrap( function(req, res) {
	/* Retrieve authorization code from request */
	let code = req.query.code;
	// passing a redirect_uri inside the auth redirect_uri allows continuing an operation after login
	let redirect_uri = req.query.redirect_uri
	/* Set options with required paramters */
	let requestOptions = {
        uri: `https://ims-na1.adobelogin.com/ims/token?grant_type=authorization_code&client_id=${process.env.KEY}&client_secret=${process.env.SECRET}&code=${code}`,
        method: 'POST',
        json: true
	}

	/* Send a POST request using the request library */
	request(requestOptions)
		.then(async (response) => {
			// use the returned token to fetch account and catalog date from Lr
			process.env.TOKEN = response.access_token;
			let sessionData = await LrSession.currentP()
			//req.session.account_id = sessionData.account.account_id
			req.session.lrSession = sessionData
			//UserData.set(sessionData.account, sessionData.catalog) 
			if (redirect_uri) {
				res.redirect( redirect_uri )
			} else {
				res.render('index', {'response':'User logged in!'});
			}
    	})
    	.catch(function (error) {
    		res.render('index', {'response':'Log in failed!'});
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
	//if (album.subtype == 'project') {
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
	if (remoteLinks==null) {
		let updateTimestamp = (new Date()).toISOString()
		publishInfo.updated = updateTimestamp
		publishInfo.remoteLinks = {
			view: "https://localhost:8000/view"
		}
		// can't call this until the apis are updated to support POST
		//let result = await lr.updateAlbumP(req.query.project_id, 'project', payload)
		console.log("add remoteLinks here")
	}
}

router.get('/', asyncWrap( async (req, res) => {
/* 	let userData =UserData.get(req.session.account_id)
	let albumsList = userData.albumsList ||  await getAlbumsList(lr)
	let albumId =  albumsList[0].id
	let album = userData.albums[album.id] */
	let lr = new LrContext(req.session.lrSession)
	let albums = await getAlbumsList(lr)
	let album = await lr.getAlbumP( albums[0].id)
	let response = await getAlbumData(lr, album)
	res.render('album', { albums: albums, album: response, response: JSON.stringify(response, null, 2) })
}))

// handles project create and resend from lightroom desktop
router.get('/albums', asyncWrap( async (req, res) => {
	let lr = new LrContext(req.session.lrSession)
	let albums = await getAlbumsList(lr)
	res.render('albumList', { albums: albums, response: JSON.stringify(albums, null, 2) })
}))

// handles project create and resend from lightroom desktop
router.get('/redirect', asyncWrap( async (req, res) => {
	let lr = new LrContext(req.session.lrSession)
	let album = await lr.getAlbumP(req.query.project_id)
	await updateAlbum(lr, album)
	let response = await getAlbumData(lr, album)
	let albums = await getAlbumsList(lr)
	res.render('album', { albums: albums, album: response, response: JSON.stringify(response, null, 2) })
}))

router.get('/view', asyncWrap( async (req, res) => {
	let lr = new LrContext(req.session.lrSession)
	let album = await lr.getAlbumP(req.query.project_id)
	let response = await getAlbumData(lr, album)
	let albums = await getAlbumsList(lr)
	res.render('album', { albums: albums, album: response, response: JSON.stringify(response, null, 2) })
}))

router.get('/thumb/:assetId', asyncWrap( async (req, res) => {
	let lr = new LrContext(req.session.lrSession)
	let assetId = req.params.assetId
	let thumb = await lr.getAssetThumbnailRenditionP(assetId)
	res.contentType('image/jpeg');
	res.send(thumb);
}))

router.get('/learn', (req, res, next) => {
	res.render('learn');
})

module.exports = router
