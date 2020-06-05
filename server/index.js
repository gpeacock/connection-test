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

// Read values from .env -> you must creeate a .env with these vaues...
const adobeApiKey = process.env.KEY;
const adobeApiSecret = process.env.SECRET;
const hostname = process.env.HOST;
const port = process.env.PORT;
const sessionSecret =  process.env.SESSIONSECRET

/* Middlewares */
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));
app.set('views', path.join(__dirname, '../views'))
app.set('view engine', 'jade')
app.use(session({
    secret: sessionSecret,
    resave: true,
    saveUninitialized: true,
    cookie: { 
        secure: false,
        maxAge: 6000000
    }
}));

app.use(require('./routes'))

/* Set up a HTTPS server with the signed certification */
var httpsServer = https.createServer({
	key: fs.readFileSync(path.join(__dirname, '../certs/key.pem')),
	cert: fs.readFileSync(path.join(__dirname, '../certs/cert.pem'))
}, app).listen(port, hostname, (err) => {
	if (err) console.log(`Error: ${err}`);
	console.log(`listening on port ${port}!`);
});
