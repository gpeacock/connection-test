const env = require('dotenv').config()
const express = require('express');
const app = express();
const session = require('express-session')
const request = require('request-promise');
const https = require('https');
//const http = require('http');
const bodyParser = require('body-parser');

const fs = require('fs');
const path = require('path');

const adobeApiKey = process.env.KEY;
const adobeApiSecret = process.env.SECRET;
const hostname = process.env.HOST;
const port = process.env.PORT;

/* Middlewares */
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));
app.set('views', path.join(__dirname, '../views'))
app.set('view engine', 'jade')
app.use(session({
	/* Change this to your own secret value */
    secret: 'this-is-secret',
    resave: true,
    saveUninitialized: true,
    cookie: { 
        secure: false,
        maxAge: 6000000
    }
}));

app.use(require('./routes'))

/* Routes */
app.get('/', function (req, res) {
	process.env.TOKEN = req.session.token
	res.render('index');
})

app.get('/login', function(req, res){
	// user redirect_url on login to get back to original call
	let redirect = req.query.redirect_uri ? '?redirect_uri='+req.query.redirect_uri : ""
	/* This will prompt user with the Adobe auth screen */
	res.redirect(`https://ims-na1.adobelogin.com/ims/authorize?client_id=${adobeApiKey}&scope=openid, lr_partner_apis&response_type=code&redirect_uri=https://localhost:8000/callback${redirect}`)
})

app.get('/callback', function(req, res){
	/* Retrieve authorization code from request */
	let code = req.query.code;
	// passing a redirect_uri inside the auth redirect_uri allows continuing an operation after login
	let redirect_uri = req.query.redirect_uri
	/* Set options with required paramters */
	let requestOptions = {
        uri: `https://ims-na1.adobelogin.com/ims/token?grant_type=authorization_code&client_id=${adobeApiKey}&client_secret=${adobeApiSecret}&code=${code}`,
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

/* Set up a HTTS server with the signed certification */

var httpsServer = https.createServer({
	key: fs.readFileSync(path.join(__dirname, 'key.pem')),
	cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
}, app).listen(port, hostname, (err) => {
	if (err) console.log(`Error: ${err}`);
	console.log(`listening on port ${port}!`);
});
/*
var httpServer = http.createServer({}, app).listen(port, hostname, (err) => {
	if (err) console.log(`Error: ${err}`);
	console.log(`http listening on port ${port}!`);
});

*/