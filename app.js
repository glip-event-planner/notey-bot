require('dotenv').config();

var express = require('express');
var request = require('request');
const RC = require('ringcentral');
const axios = require('axios');
var request = require("request");
var http = require('https');
var bodyparser = require('body-parser');

var SDK = require('ringcentral');
var rcsdk = new SDK({ 
    server: SDK.server.sandbox, 
    appKey: process.env.CLIENT_ID,
    appSecret: process.env.CLIENT_SECRET,
    redirectUri: '' // optional, but is required for Implicit Grant and Authorization Code OAuth Flows
                    // (see https://github.com/ringcentral/ringcentral-js#api-calls)
});

const PORT= process.env.PORT;
const REDIRECT_HOST= process.env.REDIRECT_HOST;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const RINGCENTRAL_ENV= process.env.RINGCENTRAL_ENV;


var app = express();
var platform, subscription, rcsdk, subscriptionId, bot_token;


// Lets start our server
app.listen(PORT, function () {
    //Callback triggered when server is successfully listening. Hurray!
    console.log("Example app listening on port " + PORT);
});

app.use(bodyparser.json());

// This route handles GET requests to our root ngrok address and responds with the same "Ngrok is working message" we used before
app.get('/', function(req, res) {
    res.send('Ngrok is working! Path Hit: ' + req.url);
});


rcsdk = new RC({
    server: RINGCENTRAL_ENV,
    appKey: CLIENT_ID,
    appSecret: CLIENT_SECRET
});

platform = rcsdk.platform();

//Authorization callback method.
app.get('/oauth', function (req, res) {
    if(!req.query.code){
        res.status(500);
        res.send({"Error": "Looks like we're not getting code."});
        console.log("Looks like we're not getting code.");
    }else {
        platform.login({
            code : req.query.code,
            redirectUri : REDIRECT_HOST + '/oauth'
        }).then(function(authResponse){
            var obj = authResponse.json();
            bot_token = obj.access_token;
            res.send(obj)
            subscribeToGlipEvents();
        }).catch(function(e){
            console.error(e)
            res.send("Error: " + e);
        })
    }
});

app.use('/voicebase/callback', function(req, res) {
   console.log("RECEIVED VOICEBASE'S OUTPUT");
   
   //   Get the transcript from the object returned by VoiceBase
   var myWords = req.body.transcript.words;
   var transcript = "";
   for (var i = 0; i < myWords.length; i++) {
       transcript = transcript.concat(myWords[i].w + " ");
   }
   
   //   ADD HERE: LOGIC THAT TURNS TRANSCRIPT INTO NOTES
   
   //   Configure RingCentral API call to get groups.
   var config = {
            headers: {
              "Authorization" : process.env.RC_BEARER
            }
   };
   //   RingCentral API Call: Fetch Teams
   axios.get('https://platform.devtest.ringcentral.com/restapi/v1.0/glip/groups?type=Team', config)
            .then(function(resp) {
              console.log("Fetching groups");
              console.log(resp.data);
              var postToThisGroupId = resp.data.records[0].id;
              //    RingCentral API Call: Post to the first Team retrieved
              axios({
                    method: 'post',
                    url: 'https://platform.devtest.ringcentral.com/restapi/v1.0/glip/posts',
                    data: {
                        groupId: postToThisGroupId,
                        text: transcript
                    },
                    headers: {
                          "Authorization" : process.env.RC_BEARER
                        }
            });
   });
});

// Callback method received after subscribing to webhook
app.post('/callback', function (req, res) {
    var validationToken = req.get('Validation-Token');
    var body =[];

    if(validationToken) {
        console.log('Responding to RingCentral as last leg to create new Webhook');
        res.setHeader('Validation-Token', validationToken);
        res.statusCode = 200;
        res.end();
    } else {
        req.on('data', function(chunk) {
            body.push(chunk);
        }).on('end', function() {
            //  Stick all our buffers into a string
            body = Buffer.concat(body).toString();
            //  Create an object version of that string
            var bodyObj = JSON.parse(body);
            //  Print the entire object that was received.
            //  If there's an attachment, print the location of it.
            if (bodyObj.body.attachments) {
                var fileLocation = bodyObj.body.attachments[0].contentUri;
                console.log("FILE LOCATION", fileLocation);
            }
            res.statusCode = 200;
            res.end(body);
            if(bodyObj.event == "/restapi/v1.0/subscription/~?threshold=60&interval=15"){
                renewSubscription(bodyObj.subscriptionId);
            }
        });
    }
});

// Method to Subscribe to Glip Events.
function subscribeToGlipEvents(token){

    var requestData = {
        "eventFilters": [
            "/restapi/v1.0/glip/posts",
            "/restapi/v1.0/glip/groups",
            "/restapi/v1.0/subscription/~?threshold=60&interval=15"
        ],
        "deliveryMode": {
            "transportType": "WebHook",
            "address": REDIRECT_HOST + "/callback"
        },
        "expiresIn": 604799
    };
    platform.post('/subscription', requestData)
        .then(function (subscriptionResponse) {
            console.log('Subscription Response: ', subscriptionResponse.json());
            subscription = subscriptionResponse;
            subscriptionId = subscriptionResponse.id;
        }).catch(function (e) {
            console.error(e);
            throw e;
    });
}

function renewSubscription(id){
    console.log("Renewing Subscription");
    platform.post('/subscription/' + id + "/renew")
        .then(function(response){
            var data = JSON.parse(response.text());
            subscriptionId = data.id
            console.log("Subscription Renewal Successfull. Next Renewal scheduled for:" + data.expirationTime);
        }).catch(function(e) {
            console.error(e);
            throw e;
        });
}