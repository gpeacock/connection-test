const express = require('express')
const router = express.Router()
//const Lr = require('./lr')
const bodyParser = require('body-parser');
const LrSession = require('../lr/LrSession')
const LrUtils = require('../lr/LrUtils')
router.use(bodyParser.raw({limit: '200mb'})) // middleware for uploading binaries

const dref = LrUtils.dref

let LightroomUserDatabase = {
	_users: {},

	get: function(accountId) {
		return LightroomUserDatabase._users[accountId]
	},

	set: function(account, catalog) {
		let user = {
			timestamp: (new Date()).toISOString(), // when this user data was updated
			account_id: account.id,
			catalog_id: catalog.id,
			full_name: account.full_name,
			email: account.email,
			status: account.entitlement.status,
			storage_used: account.entitlement.storage.used,
			storage_limit: account.entitlement.storage.limit
		}
		return LightroomUserDatabase._users[account.id] = user
	}
}

let _currentUserP = async function(session) {
	if (session.account_id) {
		return Promise.resolve(LightroomUserDatabase.get(session.account_id))
	}

	let account = await Lr.util.getAccountP(session.token)
	let status = account.entitlement.status
	if (status !== 'trial' && status !== 'subscriber') {
		return Promise.reject('get user failed: not entitled')
	}
	let catalog = await Lr.util.getCatalogP(session.token)

	// if we have reached here, we have an entitled user with a catalog
	session.account_id = account.id // set the active user
	return LightroomUserDatabase.set(account, catalog) // add to the database
}

router.get('/profile', function(req, res){
	if (req.session.token) {
		/* Grab the token stored in req.session 
		and set options with required parameters */
		let requestOptions = {
	        uri: `https://ims-na1.adobelogin.com/ims/userinfo?client_id=${process.env.KEY}`,
	        headers: {
	        	Authorization: `Bearer ${req.session.token}`
	        },
	        json: true
	    };

	    /* Send a GET request using the request library */
		request(requestOptions)
			.then(function (response) {
				/* Send the received response back to the client side */
				res.render('index', {'response':JSON.stringify(response)});
	    	})
	    	.catch(function (error) {
	    		console.log(error)
	    	});

	} else {
		res.render('index', {'response':'You need to log in first'});
	}
})

router.get('/user', function(req, res) {
	_currentUserP(req.session)
		.then((user) => {
			return JSON.stringify(user, null, 4)
		})
		.catch((error) => {
			return error
		})
		.then((result) => {
			res.render('index', { response: result })
		})
})

router.put('/upload/image', function(req, res) {
	_currentUserP(req.session)
		.then((user) => {
			if (user.storage_used + req.body.length > user.storage_limit) {
				return Promise.reject('upload failed: insufficient storage')
			}
			let fileName = decodeURIComponent(req.query.file_name)
			return Lr.util.uploadImageP(req.session.token, user.account_id, user.catalog_id, fileName, req.body)
		})
		.catch((error) => {
			return error
		})
		.then((result) => {
			res.send(result)
		})
})

const asyncWrap = fn =>
  function asyncUtilWrap (req, res, next, ...args) {
    const fnReturn = fn(req, res, next, ...args)
    return Promise.resolve(fnReturn).catch(next)
  }
  
router.get('/health', asyncWrap( async (req, res) => {
	let lr = await LrSession.currentContextP()
	let result = await lr.getHealthP()
	res.render('index', { response: JSON.stringify(result, null, 2) })
}))

router.get('/catalog', asyncWrap( async (req, res) => {
	let lr = await LrSession.currentContextP()
	//let result = await lr.getCatalogP()
	res.render('index', { response: JSON.stringify(lr.catalog, null, 2) })
}))

router.get('/account', asyncWrap( async (req, res) => {
	let lr = await LrSession.currentContextP()
	//let result = await lr.getCatalogP()
	res.render('index', { response: JSON.stringify(lr.account, null, 2) })
}))

router.get('/projects', asyncWrap( async (req, res) => {
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

router.get('/user', asyncWrap( async (req, res) => {
	let lr = await LrSession.currentContextP()
	let result = await lr.getAlbumsP('project_set%3Bproject')
	console.log(JSON.stringify(result, null, 2))
	res.render('index', { response: JSON.stringify(result, null, 2) })
}))

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

module.exports = router
