const env = require('dotenv').config()
const express = require('express');
const app = express();
const session = require('express-session')
const request = require('request-promise');
const https = require('https');
const bodyParser = require('body-parser');

const fs = require('fs');
const path = require('path');

// these should be defined in .env
const hostname = process.env.HOST || 'localhost';
const port = process.env.PORT || 8000;
const sessionSecret =  process.env.SESSIONSECRET || 'session_secret'

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

// if we have local certs then set up an https server
if (fs.existsSync(path.join(__dirname, '../certs/key.pem'))) {
    /* Set up a HTTPS server with the signed certification */
    var httpsServer = https.createServer({
        key: fs.readFileSync(path.join(__dirname, '../certs/key.pem')),
        cert: fs.readFileSync(path.join(__dirname, '../certs/cert.pem'))
    }, app).listen(port, hostname, (err) => {
        if (err) console.log(`Error: ${err}`);
        console.log(`${Date.now()} Server started on port ${port}`);
    });
} else {

app.listen(port, () => {
    console.log(`${Date.now()} Server started on port ${port}`);
});
}
