const express = require('express')
const router = express.Router()
//const Lr = require('./lr')
const request = require('request-promise');
const bodyParser = require('body-parser');
const LrSession = require('../lr/LrSession')
const LrUtils = require('../lr/LrUtils')
router.use(bodyParser.raw({limit: '200mb'})) // middleware for uploading binaries

const dref = LrUtils.dref

const asyncWrap = fn =>
	function asyncUtilWrap (req, res, next, ...args) {
    	const fnReturn = fn(req, res, next, ...args)
    	return Promise.resolve(fnReturn).catch(next)
	}

// log requests and errors to console
router.use((req, res, next) => {
	if (!req.session.token && req.path != "/callback") {
		console.log(`login redirect for +${req.originalUrl}`)
		res.redirect(`https://ims-na1.adobelogin.com/ims/authorize?client_id=${process.env.KEY}&scope=openid, lr_partner_apis&response_type=code&redirect_uri=https://localhost:8000/callback?redirect_uri=https://localhost:8000${req.originalUrl}`)
	} else {
		next()
	}
  });	
  
  router.get('/callback', function(req, res) {
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
		.then(function (response) {
			/* Store the token in req.session.token */
			req.session.token = response.access_token;
			process.env.TOKEN = response.access_token;
			if (redirect_uri) {
				res.redirect( redirect_uri )
			} else {
				res.render('index', {'response':'User logged in!'});
			}
    	})
    	.catch(function (error) {
    		res.render('index', {'response':'Log in failed!'});
    	});
})


router.get('/', asyncWrap( async (req, res) => {
	let lr = await LrSession.currentContextP()
	let result = await lr.getAlbumsP('project_set%3Bproject')
	console.log(JSON.stringify(result, null, 2))
	res.render('index', { response: JSON.stringify(result, null, 2) })
}))

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

// handles project create and resend from lightroom desktop
router.get('/redirect', asyncWrap( async (req, res) => {
	let lr = await LrSession.currentContextP()
	let album = await lr.getAlbumP(req.query.project_id)
	let payload =  dref(album, 'payload' )
	let publishInfo = dref(album, 'payload','publishInfo')
	let remoteLinks = dref(album, 'payload','publishInfo','emoteLinks' )
	if (remoteLinks==null) {
		let updateTimestamp = (new Date()).toISOString()
		publishInfo.updated = updateTimestamp
		publishInfo.remoteLinks = {
			view: "https://localhost:8000/view"
		}
		//let result = await lr.updateAlbumP(req.query.project_id, 'project', payload)
		console.log("add remoteLinks here")
	}
	let response = await getAlbumData(lr, album)

	res.render('album', { album: response, response: JSON.stringify(response, null, 2) })
}))

router.get('/view', asyncWrap( async (req, res) => {
	let lr = await LrSession.currentContextP()
	let album = await lr.getAlbumP(req.query.project_id)
	let response = await getAlbumData(lr, album)
	res.render('album', { album: response, response: JSON.stringify(response, null, 2) })
}))

router.get('/thumb/:assetId', asyncWrap( async (req, res) => {
	let lr = await LrSession.currentContextP()
	let assetId = req.params.assetId
	let thumb = await lr.getAssetThumbnailRenditionP(assetId)
	res.contentType('image/jpeg');
	res.send(thumb);
}))

router.get('/learn', (req, res, next) => {
	res.status(200).send("learning");
	next();
})

module.exports = router
