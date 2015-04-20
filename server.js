var marked = require('marked');
var sqlite3 = require('sqlite3');
var express = require('express');
var session = require('express-session');
var override = require('method-override');
var bodyParser = require('body-parser');
var MongoStore = require('connect-mongo')(session);
var mustache = require('mustache');
var request = require('request');
var fs = require('fs');
var nodemailer = require('nodemailer');
var smtpTransport = require('nodemailer-smtp-transport');
var secrets = require('./secrets.json');

// set up transporter to send email via mandrill's smtp server
var transporter = nodemailer.createTransport(smtpTransport({
  host: "smtp.mandrillapp.com",
  port: 587,
  auth: secrets.mandrill //{user: username, pass: apikey}
}));

var formcss;
fs.readFile("./public/formcss.css", function(err,data) {
  if (err) throw(err);
  formcss = data.toString();
});


// ***********************************   initialization stuff   ***********************************

var db = new sqlite3.Database('wiki.db');

var app = express();
app.use(override('_method'));

app.use(session({
  store: new MongoStore({
    host: '127.0.0.1',
      port: 27017,
      db: "wiki"
  }),
  secret: 'a fancy secret',
  resave: false,
  saveUninitialized: true,
  cookie: {
    maxAge: 600000
  }
}));

app.use(bodyParser.urlencoded({
  extended: false
}));


// *********************************** user login routes ***********************************

app.get("/users/new", function (req,res) {
  ensureUser(req);
  res.render("users/edit.ejs", {formaction: "/users", msg:"", name:"", email:"", username:"", user: req.session.user, css: formcss, title: "new account", editable: false});
});
app.get("/user/:username/edit", function(req,res) {
  ensureUser(req);
  db.get("SELECT username,name,email FROM users WHERE username = ?", req.params.username, function(err,data) {
    if (typeof data === 'undefined') {
      res.send("user not found");
    } else {
      res.render("users/edit.ejs", {usernamefixed: true, formaction: "/user/"+req.params.username+"?_method=PUT", msg:"", name:data.name, email:data.email, username:data.username, user: req.session.user, css: formcss, title: data.username, editable: false});
    }
  });
});


app.get("/users/login", function (req,res) {
  ensureUser(req);
  res.render("users/login.ejs", {user: req.session.user, css: formcss, title: "", editable: false});
});

app.post("/users/login", function (req,res) {
  ensureUser(req);
  db.get("SELECT username FROM users WHERE username = ?", req.body.username, function(err,data) {
    if (typeof data === 'undefined') {
      req.session.user.loginmessage = "username "+req.body.username+" does not exist in our database";
      res.render("users/login.ejs", {user: req.session.user, css: formcss, title: "", editable: false});
    } else {
      req.session.user.username = req.body.username;
      res.redirect(req.session.user.curpage);
    }
  });
});

app.get("/users/logout", function (req,res) {
  ensureUser(req);
  req.session.user.username = "guest";
  res.redirect(req.session.user.curpage);
});

// receive user update
app.put("/user/:username", function(req,res) {
  db.run("UPDATE users SET name=?, email=? WHERE username=?",
    req.body.name, req.body.email, req.params.username,
    function(err) {
      if (err) throw(err);
      res.redirect("/user/"+req.params.username);
    }
  );
});


// receive new user form post
app.post("/users", function (req,res) {
  ensureUser(req);
  db.get("SELECT username FROM users WHERE username = ?",req.body.username, function(err,data) {
    // if the chosen username is taken or is "guest" then bounce user back to form
    if (typeof data !== 'undefined' || req.body.username === "guest") {
      res.redirect("users/edit.ejs", {formaction: "/users", msg:"that username is taken", name:req.body.name, email:req.body.email, username:req.body.username, user: req.session.user, css: formcss, title: "new account", editable: false});
    
    // else, chosen username isn't taken so insert new user into db
    } else {
      db.run("INSERT INTO users (name,email,username) VALUES (?,?,?)", req.body.name, req.body.email, req.body.username,
        function(err,data) {
          req.session.user.username = req.body.username;
          res.redirect(req.session.user.curpage);
        }
      );
    }
  });
});


// *********************************** user profile routes ***********************************

app.get("/user/:username", function(req,res) {
  ensureUser(req);
  db.get("SELECT username,name,email FROM users WHERE username = ?",req.params.username, function(err,userdata) {
    if (typeof userdata === 'undefined') {
      res.send("user not found");
    } else {
      db.all("SELECT docid,title,max(version) FROM versionedDocs WHERE docid IN "+
        "(SELECT DISTINCT docid FROM versionedDocs WHERE userid = ?) "+
        "GROUP BY docid", req.params.username, function(err,data) {
          var titles = data.map(function(row) {return row.title;});
          db.all("SELECT subscriptions.docid as docid, title "+
            "FROM subscriptions "+
            "JOIN docs ON subscriptions.docid = docs.docid "+
            "JOIN versionedDocs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version "+
            "WHERE subscriptions.username = ?", req.params.username,
            function(err,subdata) {
              res.render("users/show.ejs", {profile: userdata, titles: titles, subscriptions: subdata, user: req.session.user, css: formcss, title: req.params.username + "'s Profile", editable: false});
            }
          );
        }
      );
    }
  });
});

// *********************************** user subscriptions ***********************************

app.post("/doc/:docid/subscribe", function(req,res) {
  ensureUser(req);

  // if user is a guest, send them to login before they subscribe
  if (req.session.user.username === "guest") {
    req.session.user.prevpage = req.session.user.curpage;
    req.session.user.curpage = "/doc/"+req.params.docid+"/subscribe";
    req.session.user.loginmessage = "login to subscribe";
    res.redirect("/users/login");

  // else, user is logged in, so proceed with doc creation
  } else {
    db.run("INSERT INTO subscriptions (username, docid) VALUES (?,?)", req.session.user.username, req.params.docid, function(err) {
      if (err) throw(err);
      db.get("SELECT title FROM versionedDocs "+
        "JOIN docs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version "+
        "WHERE docs.docid = ?", req.params.docid, function(err,data) {
          if (err) throw(err);
          if (typeof data === 'undefined') res.send("doc not found");
          else res.redirect("/doc/"+data.title);
        }
      );
    });
  }
});

app.delete("/subscription/:username/:docid", function(req,res) {
  db.run("DELETE FROM subscriptions WHERE username = ? AND docid = ?", req.params.username, req.params.docid, function(err) {
    if (err) throw(err);
    res.redirect("/user/"+req.params.username);
  });
});



// *********************************** doc reading routes ***********************************

// retrieve index of docs
app.get("/", function (req,res) {
  ensureUser(req);
  res.redirect("/doc/main");
});
app.get("/docs", function (req,res) {
  ensureUser(req);
  res.redirect("/doc/main");
});


// search for doc
app.get("/docs/search", function(req,res) {
  ensureUser(req);
  if (typeof req.query.search === 'undefined' || req.query.search.length === 0) {

    // if searchstring is empty then redirect to main
    res.redirect("/doc/main");
  } else {

    // we have a search string, so find all matching current titles in versionedDocs
    db.all("SELECT title FROM versionedDocs JOIN docs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version "+
      "WHERE title LIKE ?", "%"+req.query.search+"%", function(err,titledata) {
        if (err) throw(err);

        // also search for matching document bodies
        db.all("SELECT title FROM versionedDocs "+
          "JOIN docs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version "+
          "WHERE body LIKE ?", "%"+req.query.search+"%", function(err,bodydata) {
            if (err) throw(err);

            //render our results
            res.render("docs/searchresults.ejs", {
              titles: titledata,
              bodies: bodydata,
              title: "Search Results",
              css: formcss,
              user: req.session.user,
              editable: false
            });
          }
        );
      }
    );
  }
});


// retrieve doc by title
app.get("/doc/:title", function (req,res) {
  ensureUser(req);

  // grab current version of doc as indicated by docs table
  db.get( "SELECT title,body,html,css,numpanes FROM"+
          " versionedDocs"+
          " JOIN docs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version"+
          " JOIN layouts ON versionedDocs.layout = layouts.name"+
          " WHERE title = ?",
    req.params.title,
    function(err,data) {
      if (err) throw(err);

      // if we didn't find any doc by that title then go to a new document form
      if (typeof data === 'undefined') {

        // if user is a guest, send them to the login page before we allow them to create a doc
        if (req.session.user.username === "guest") {
          req.session.user.prevpage = req.session.user.curpage;
          req.session.user.curpage = "/doc/"+req.params.title;
          req.session.user.loginmessage = req.params.title + " not found. Login to create a new doc";
          res.redirect("/users/login");

        // user is logged in, so proceed with doc creation
        } else {
          db.all("SELECT name,numpanes FROM layouts", function (err,data) {
            if (err) throw(err);
            res.render("docs/edit.ejs", {
              formaction: "/docs",
              docid:0,
              title: req.params.title,
              body: '[""]',
              comment: "created",
              layoutname: data[0].name,
              numpanes: data[0].numpanes,
              user: req.session.user,
              layouts: data,
              css: formcss,
              editable: false
            });
          });
        }

      // we found our doc
      } else {
        ensureUser(req);
        req.session.user.curpage = "/doc/"+req.params.title;

        // swap out [[ ]] tags for their counterparts from our keywords function
        parseTagsInArray(JSON.parse(data.body), keywords, function(arr) {

          // parse the document body into content panes
          var contents = {title: req.params.title};
          for (var i=0; i<arr.length; i++) {
            contents["content"+i] = marked(arr[i]);
          }

          // render
          res.render("docs/show.ejs",{
            title: data.title,
            content: mustache.render(data.html,contents),
            css:data.css,
            user: req.session.user,
            editable: true});
        });
      }
    });
});


// *********************************** doc edit routes ***********************************

// retrieve new doc form. uses same form as editpage
app.get("/docs/new", function (req,res) {
  ensureUser(req);

  // if user is a guest, send them to the login page before we allow them to create a doc
  if (req.session.user.username === "guest") {
    req.session.user.prevpage = req.session.user.curpage;
    req.session.user.curpage = "/docs/new";
    req.session.user.loginmessage = "login to create a new doc";
    res.redirect("/users/login");

  // user is logged in, so proceed with doc creation
  } else {
    db.all("SELECT name,numpanes FROM layouts", function (err,data) {
      if (err) throw(err);
      res.render("docs/edit.ejs", {
        formaction: "/docs",
        docid:0,
        title: "untitled",
        body: '[""]',
        comment: "created",
        layoutname: data[0].name,
        numpanes: data[0].numpanes,
        user: req.session.user,
        layouts: data,
        css: formcss,
        editable: false
      });
    });
  }
});

// retrieve edit page for doc
app.get("/doc/:title/edit", function (req,res) {
  ensureUser(req);

  // if user is a guest, send them to the login page before we allow them to edit a doc
  if (req.session.user.username === "guest") {
    req.session.user.prevpage = "/doc/"+req.params.title;
    req.session.user.curpage = "/doc/"+req.params.title+"/edit";
    req.session.user.loginmessage = "login to edit "+req.params.title;
    res.redirect("/users/login");

  // user is logged in, so proceed with doc editing
  } else {
    db.get( "SELECT title,body,docs.docid,numpanes,name "+
            "FROM versionedDocs "+
            "JOIN docs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version "+
            "JOIN layouts ON versionedDocs.layout = layouts.name "+
            "WHERE title = ?",
      req.params.title,
      function(err,data) {
        if (err) throw(err);
        if (typeof data === "undefined") {
          res.send(req.params.title + " not found.");
        } else {
          db.all("SELECT name,numpanes FROM layouts", function(err,layouts) {
            ensureUser(req);
            res.render("docs/edit.ejs",{
              formaction: "/doc/"+data.docid,
              docid: data.docid,
              title: data.title,
              body: data.body,
              comment: "updated",
              layoutname: data.name,
              numpanes: data.numpanes,
              user: req.session.user,
              layouts: layouts,
              css: formcss,
              editable: false});
          });
        }
      }
    );
  }
});

// update doc docid.
app.post("/doc/:docid", function (req,res) {
  ensureUser(req);

  // get highest numbered version so we can increment by one
  db.get("SELECT max(version),title FROM versionedDocs WHERE docid = ?", req.params.docid, function (err,data) {
    if (err) throw(err);

    // if we failed to get doc, send error message
    if (typeof data === "undefined") {
      res.send("oops! couldn't find the doc to update");

    // else, we got our version, so increment it by one for our new version
    } else {
      version = data["max(version)"] + 1;

      // collect all our paned content in an array
      var content=[];
      for (var i=0; i<req.body.numpanes; i++) {
        content.push(req.body["content"+i]);
      }

      // block renaming of the main page
      if (data.title === "main") req.body.title = data.title;

      // perform db insert of our newest version to versionedDocs
      db.run("INSERT INTO versionedDocs (docid,title,layout,body,version,userid,changed,comment) VALUES (?,?,?,?,?,?,strftime('%s','now'),?)",
        req.params.docid, req.body.title, req.body.layout, JSON.stringify(content), version, req.session.user.username, req.body.comment,
        function (err) {
          if (err) throw(err);

          // update docs to point to our new version
          db.run("UPDATE docs SET version = ? WHERE docid = ?", version, req.params.docid, function (err) {
            if (err) throw(err);

            // redirect to the new document
            res.redirect("/doc/"+req.body.title);

            // notify subscribers of the change
            notifySubscribers(req.params.docid, req.body.title, req.body.comment, req.session.user.username);
          });
        }
      );
    }
  });
});

// delete doc by title
app.delete("/doc/:docid", function(req,res) {
  db.run("DELETE FROM docs WHERE docid = ?", req.params.docid, function(err) {
    if (err) throw(err);
    res.redirect("/doc/main");
  });
});

// add new doc
app.post("/docs", function (req,res) {
  var content = [];
  for (var i=0;i<req.body.numpanes; i++) {
    content.push(req.body["content"+i]);
  }
  db.run("INSERT INTO docs (version, docid) SELECT 1, max(docid)+1 FROM versionedDocs", function (err) {
    if (err) throw(err);
    db.run("INSERT INTO versionedDocs (docid, title, layout, body, version, userid, changed, comment) VALUES (?,?,?,?,?,?,strftime('%s','now'),?)",
      this.lastID, req.body.title, req.body.layout, JSON.stringify(content), 1, req.session.user.username, req.body.comment, 
      function (err) {
        if (err) throw(err);
        res.redirect("/doc/"+req.body.title);
      });
  });
});

// *********************************** doc history routes ***********************************

app.get("/doc/:docid/history", function (req,res) {
  ensureUser(req);
  db.all("SELECT title,userid,datetime(changed,'unixepoch') as time,comment,docid,version FROM versionedDocs WHERE docid = ?", req.params.docid, function(err,data) {
    if (err) throw(err);
    if (data.length === 0) {
      res.send("doc not found");
    } else {
      res.render("docs/history.ejs", {
        title: "History",
        history: data,
        user: req.session.user,
        css: formcss,
        editable: false}
      );
    }
  });
});

//docid INTEGER, title TEXT, layout TEXT, body TEXT, version INTEGER, userid INTEGER, changed INTEGER, comment TEXT

app.post("/doc/:docid/revert/:version", function(req,res) {
  db.get("SELECT max(version) as version FROM versionedDocs WHERE docid = ?", req.params.docid, function(err,versiondata) {
    if (err) throw(err);
    var version = Number(versiondata.version) + 1;
    db.run("INSERT INTO versionedDocs (docid, title, layout, body, version, userid, changed, comment) "+
      "SELECT docid, title, layout, body, ?, userid, strftime('%s','now'), ? "+
      "FROM versionedDocs WHERE docid = ? AND version = ?",
      version, "reverted to version "+req.params.version, req.params.docid, req.params.version, function(err) {
        if (err) throw(err);
        db.get("SELECT max(version) as version, title FROM versionedDocs WHERE docid = ?", req.params.docid, function(err,data) {
          if (err) throw(err);
          db.run("UPDATE docs SET version = ? WHERE docid = ?", data.version, req.params.docid, function(err) {
            if (err) throw(err);
            res.redirect("/doc/"+data.title);
          });
        });
      });
  });
});

// *********************************** layout edit routes ***********************************

app.get("/layout/:name/edit", function (req,res) {
  ensureUser(req);
  db.get("SELECT name,numpanes,html,css FROM layouts WHERE name = ?", req.params.name, function(err,data) {
    if (err) throw(err);
    res.render("layouts/edit.ejs", {msg: "", name:data.name, oldname:data.name, numpanes:data.numpanes, html:data.html, cssdata: data.css, css: formcss, user: req.session.user, title: "", editable: false});
  });
});

app.put("/layout/:name", function(req,res) {
  if (req.params.name === "plain" && req.body.name !== "plain") {
    // if somebody tries to rename "plain" layout bounce them back to the edit form
    res.render("layouts/edit.ejs", {msg: "Can't rename \"plain\" layout.", name:"plain", oldname:req.params.name, numpanes:req.body.numpanes, html:req.body.html, cssdata:req.body.css, css: formcss, user: req.session.user, title: "", editable: false});
  } else {
    if (req.params.name !== req.body.name) { //we are trying to rename a layout, so make sure it isn't in use by somebody else
      db.get("SELECT name FROM layouts WHERE name = ?", req.body.name, function(err,data) {
        if (err) throw(err);
        if (typeof data === 'undefined') {
          //name isn't in use so go ahead and update
          doupdate();
        } else {
          //name is in use, so go back to the edit form
          res.render(
            "layouts/edit.ejs",
            {msg: "That name is in use by another layout", name:req.body.name, oldname:req.params.name, numpanes:req.body.numpanes, html:req.body.html, cssdata:req.body.css, css: formcss, user: req.session.user, title: "", editable: false}
          );
        }
      });
    } else {
      doupdate();
    }
    function doupdate() {
      db.run("UPDATE layouts SET name=?, html=?, numpanes=?, css=? WHERE name=?",
        req.body.name, req.body.html, req.body.numpanes, req.body.css, req.params.name,
        function(err) {
          if (err) throw(err);
          res.redirect("/doc/main");
        }
      );
    }
  }
});


// *********************************** validation and ajax routes ***********************************


// is doc title available?
app.post("/titleIsAvailable", function (req,res) {
  db.get("SELECT docs.docid FROM versionedDocs "+
    "JOIN docs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version "+
    "WHERE title = ? AND docs.docid != ?", req.body.title, req.body.docid, function (err,data) {
    if (typeof data === "undefined") {
      res.send(true);
    } else {
      res.send(false);
    }
  });
});

// is username available?
// app.post("/usernameIsAvailable", function (req,res) {
//   db.get("SELECT username FROM users", function (err,data) {
//     if (typeof data === "undefined") {
//       res.send(true);
//     } else {
//       res.send(false);
//     }
//   });
// });


// *********************************** server start ***********************************


app.listen(3000, function() {console.log("listening to port 3000");});


// *********************************** utility functions ***********************************

function notifySubscribers(docid, title, comment, username) {
  db.all("SELECT email FROM subscriptions JOIN users ON subscriptions.username = users.username WHERE docid = ?", docid, function(err,data) {
    if (err) throw(err);
    if (data.length > 0) {
      console.log(data);

      // create mailOptions object to send to our subscribers
      var mailOptions = {
        from: "projectWIKI@evangriffiths.nyc",
        to: data.map(function(row) {return row.email;}).join(", "),
        subject: "projectWIKI: "+title + " updated",
        text: username + " updated " + title + "\n"+comment
      };

      // send the message with our transporter
      transporter.sendMail(mailOptions, function(err,info) {
        if (err) {
          console.log("sendMail error: "+err);
        } else {
          console.log("sent: "+info.response);
        }
      });
    }
  });
}


// call this to set up our session variable to deal with users entering our site on random pages
function ensureUser(req) {
  if (!req.session.user) {
    req.session.user = {username: "guest", curpage: "/", prevpage: "/", loginmessage: ""};
  }
}


// keywords is called by parseTags to perform the actual tag replacement once a tag is located
function keywords(text,next) {

  // check if the first char is a !, which means that our tag is a function
  if (text.charAt(0) === '!') {
    var func = text.substring(1).trim().replace(/\s+/g," ").split(' ');
    if (func.length > 0) {
      var args = func.slice(1);

      // alldocs - display list of links of all current documents
      if (func[0] === 'alldocs') {
        db.all("SELECT title FROM docs JOIN versionedDocs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version", function (err,data) {
          if (err) throw(err);
          next(data.map(function(row) {return "- ["+row.title+"]("+row.title+")";}).join('\n'));
        });

      // recentdocs num - display list of most recently edited documents, limited to num (default 10)
      } else if (func[0] === 'recentdocs') {
        var limit = args.length>0 ? args[0] : 10;
        db.all("SELECT title FROM docs JOIN versionedDocs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version ORDER BY versionedDocs.changed DESC LIMIT ?",limit , function (err,data) {
          if (err) throw(err);
          next(data.map(function(row) {return "- ["+row.title+"]("+row.title+")";}).join('\n'));
        });

      // alllayouts - display list of links to edit pages of all the layouts
      } else if (func[0] === 'alllayouts') {
        db.all("SELECT name FROM layouts", function(err,data){
          if (err) throw(err);
          next(data.map(function(row) {return "- ["+row.name+"](/layout/"+row.name+"/edit)";}).join('\n'));
        });

      // instagram tag - display low_resolution version of the first result of an instagram api call with tag
      } else if (func[0] === 'instagram' && args.length > 0) {
        var url = "https://api.instagram.com/v1/tags/" + args.join('+') + "/media/recent?client_id=" + secrets.instagram.apikey;
        try {
          request(url, function(err,response,body) {
            if (err) {
              next("instagram error: "+err);
            } else {
              var imgurl = "";
              body = JSON.parse(body);
              for (var i=0; i<body.data.length && imgurl.length===0; i++) {
                if (body.data[i].type === "image") imgurl = body.data[i].images.low_resolution.url;
              }
              if (imgurl === "" ) {
                next("instagram no image");
              } else {
                next("!["+func+" "+args.join(" ")+"]("+imgurl+")");
              }
            }
          });

        // handle unexpected request errors without crashing server
        } catch (err) {
          next("err thrown: "+err);
        }

      // referers title - display a list of all documents with [[title]] in their body somewhere
      } else if (func[0] === 'referers') {
        if (args.length !== 1) {
          next("referers takes one argument, a doc title");
        } else {

          // grab doc list from db
          db.all("SELECT title FROM versionedDocs "+
            "JOIN docs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version "+
            "WHERE body LIKE ?", "%[["+args[0]+"]]%",
            function(err,data) {
              if (err) throw(err);

              // convert titles to markdown links and send them to next
              next( data.map(function(row) {return "["+row.title+"](/doc/"+row.title+")";}).join('\n') );
            }
          );
        }

      // unknown function
      } else {
        next("unknown function: "+func);
      }

    // function tags with empty string inside, so render empty string
    } else {
      next("");
    }

  // no ! in front means this is a local document link
  } else {
    var doctitle = text.trim();
    next("["+doctitle+"]("+doctitle+")"); // markdown link to doctitle
  }
}

// call parseTags repeatedly and pass an array of the results to next
function parseTagsInArray(arr,callback,next) {
  var results = [];
  parseit(0);
  function parseit(i) {
    if (i < arr.length) {
      parseTags(arr[i], callback, function(text) {
        results.push(text);
        parseit(i+1);
      });
    } else {
      next(results);
    }
  }
}


// replace all occurances of [[text]] in string with the return value from callback(text)
function parseTags(string,callback,next) {

  function Tag(start) {
    this.start = start;
    this.text = "";
    this.length = 0;
  }

  var tags = [];
  var state = 0;
  var curtagid = -1;

  // run through string char by char to find our tags
  for (var i=0; i<string.length; i++) {
    switch (state) {
      case -1: //outside tag and backslashed
        state = 0;
        break;
      case 0: //outside tag
        switch (string.charAt(i)) {
          case '[':
            state = 1;
            break;
          case '\\':
            state = -1;
            break;
        }
        break;
      case 1: //halfway inside tag
        if (string.charAt(i) === '[') {state = 2; tags.push(new Tag(i-1));}
        else {state = 0;}
        break;
      case 2: //inside tag
        if (string.charAt(i) === '\\') {state = 3;}
        else if (string.charAt(i) === ']') {state = 4;}
        else {tags[tags.length-1].text += string.charAt(i);}
        break;
      case 3: //inside tag backslashed
        state = 2;
        tags[tags.length-1].text += string.charAt(i);
        break;
      case 4: //first exit ]
        if (string.charAt(i) === ']') {tags[tags.length-1].length = i-tags[tags.length-1].start+1; state = 0;}
        else if (string.charAt(i) === '\\') {tags[tags.length-1].text += string.charAt(i-1); state=3;}
        else {tags[tags.length-1].text += string.charAt(i-1)+string.charAt(i); state=2;}
        break;
    }
  }

  // now that we have a list of tags, loop through them and get replacements from callback
  var lastpos = 0;
  innerReplaceTags(tags, -1, 0, string, "", "");
  function innerReplaceTags(tags, tagid, lastpos, origstring, curstring, newstring) {
    curstring += newstring;
    tagid++;
    if (tagid < tags.length) {
      curstring += origstring.substring(lastpos, tags[tagid].start);
      callback(tags[tagid].text, innerReplaceTags.bind(null,tags,tagid,tags[tagid].start+tags[tagid].length,origstring,curstring));
    } else {
      curstring += string.substring(lastpos);
      next(curstring);
    }
  }
}