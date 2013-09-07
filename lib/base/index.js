var my = this,
    fs = require('fs'),
    http = require('http');

my.template = function(str, data) {
    return str.replace(/\{\{\s+(\w+(\.\w+)*)\s+\}\}/g, function(src, name) { 
        var part,
            parts = name.split('.'),
            cur = data;

         while  (part = parts.shift()) { 
            if (!(part in cur)) { 
                return ''; 
            } 

            cur = cur[part];
        } 

        return cur; 
    });
};

my.render = function(filename) {
    var content = fs.readFileSync(filename, 'utf8');

    fs.watchFile(filename, function() {
        console.log('File "' + filename + '" was changed');

        fs.readFile(filename, 'utf8', function(err, data) {
            if (err) {
                throw err;
            }

            content = data;
        });
    });

    return function(data) {
        return my.template(content, data);
    };
};

my.HttpServer = function(options) {       
    var self = this,
        runned = false,
        // настройки по-умолчанию
        defaults = {            
            allowedMethods: ['DELETE', 'GET', 'POST', 'PUT'],
            maxRequestLength: 20000000,
            webRoot: './webroot',
            indexFiles: ['index.htm', 'index.html', 'default.htm', 'default.html'],
            host: '127.0.0.1',
            port: 80
        },
        routeMap = {},
        customTpl = my.render(__dirname + '/data/custom.tpl');
    self.mimeTypes = {};

    function setProperties() {
        options = options || {};

        for (var p in defaults) {
            if (defaults.hasOwnProperty(p)) {
                self[p] = p in options ? options[p] : defaults[p];
            }
        }
    }

    function loadMimeTypes() {
        var data = fs.readFileSync(__dirname + '/data/mime.types', 'ascii');
        data = data.replace(/#(.*)\n|\n+$/g, '');
        data = data.split('\n');
        var i = data.length, 
            parts, 
            j;

        while (i--) {
            parts = data[i].split(/\s+/g);
            j = parts.length;

            while (--j) {
                self.mimeTypes[parts[j]] = parts[0];
            }
        }
    }

    self.getMimeType = function(filename) {
        var matches = filename.match(/\.(\w+)$/);

        if (matches) {
            var extension = matches[1];

            if (extension in self.mimeTypes) {
                return self.mimeTypes[extension];
            }
        }

        return null;
    };

    self.addRoute = function(method, rule, cb) {
        if (!(method in routeMap)) {
            routeMap[method] = [];
        }

        routeMap[method].push([rule, cb]);
    };

    self.get = function(rule, cb) {
        self.addRoute('GET', rule, cb);
    };

    self.post = function(rule, cb) {
        self.addRoute('POST', rule, cb);
    };

    self.put = function(rule, cb) {
        self.addRoute('PUT', rule, cb);
    };

    self.delete = function(rule, cb) {
        self.addRoute('DELETE', rule, cb);
    };

    self.run = function() {
        if (runned) {
            throw 'Server is already running';
        }

        runned = true;

        http.createServer(function(req, res) {
            function errPage(statusCode, message) {            
                var status = http.STATUS_CODES[statusCode],
                    html = customTpl({
                        title: statusCode + ' - ' + status,
                        heading: status,
                        content: '<p>' + message + '</p>'
                    }); 
                res.writeHead(statusCode, {'Content-Type': 'text/html'});
                res.end(html);
            }

            function err403() {
                errPage(403, 'Access denied.');
            }

            function err404() {
                errPage(404, 'File or directory not found.');
            }

            function err405() {
                errPage(405, 'HTTP request "' + req.method + '" method is not supported by this URL.')
            }

            function err413() {
                errPage(413, 'Maximum request length exceeded.');
            }

            function err500() {
                errPage(500, 'An application error cccured.');
            } 

            function err501() {
                 errPage(501, 'HTTP request "' + req.method + '" method is not implemented.')
            }

            function sendFile(filename, stats) {                   
                var stream = fs.createReadStream(filename);

                stream.on('error', function() {
                    console.log(err.stack);
                });

                stream.on('open', function() {
                    var mime;
                    res.setHeader('Last-Modified', stats.mtime.toUTCString());   

                    if (mime = self.getMimeType(filename)) {
                        res.setHeader('Content-Type', mime);
                    }

                    res.setHeader('Content-Length', stats.size);
                });

                stream.pipe(res);
            };

            if (self.allowedMethods.indexOf(req.method) == -1) {
                return err501();
            }

            var len = parseInt(req.headers['content-length']);

            if (len && len > self.maxRequestLength) { 
                return err413();
            }              

            req.on('error', function(err) {
                console.log(err.stack);
            });

            var received = 0;
            req.body = '';

            req.on('data', function(chunk) {
                if ((received += chunk.length) > self.maxRequestLength) {
                    return this.destroy();
                }

                console.log('Received data: ' + chunk.length + ' bytes');
                req.body += chunk;
            });

            req.on('end', function() {
                var uri = decodeURI(this.url.split('?')[0]).replace(/[\\/]+/g, '/'),
                    path = self.webRoot + uri;

                if (req.method in routeMap) {
                    var routes = routeMap[req.method],
                        i = routes.length,
                        route,
                        rule,
                        cb,
                        matches;

                    while (i--) {
                        route = routes[i];
                        rule = route[0];
                        cb = route[1];

                        if (rule instanceof RegExp) {
                            matches = uri.match(rule);

                            if (matches) {
                                return cb.apply(null, [req, res].concat(matches.slice(1)));
                            }
                        }
                        else if (rule == uri) {
                            return cb(req, res);
                        }
                    }
                }             

                fs.exists(path, function(exists) {
                    if (!exists) {
                        return err404();
                    }

                    if (req.method != 'GET') {
                        return err405();
                    }

                    fs.stat(path, function(err, stats) {
                        if (err) {
                            console.log(err.stack);
                            return;
                        }

                        if (stats.isDirectory()) {
                            fs.readdir(path, function(err, files) {
                                if (err) {
                                    console.log(err.stack);
                                    return;
                                }

                                var i = 0;

                                while (i < self.indexFiles.length) {
                                    if (files.indexOf(self.indexFiles[i]) >= 0) {
                                        var filename = path + '/' + self.indexFiles[i];

                                        fs.stat(filename, function(err, stats) {
                                            if (stats && stats.isFile()) {
                                                return sendFile(filename, stats);
                                            }

                                            err500();
                                        });

                                        return;
                                    }

                                    ++i;
                                }

                                var _uri = uri + (/\/$/.test(uri) ? '' : '/'); 

                                var html = customTpl({
                                    title: 'Directory listing',
                                    heading: 'Index of ' + uri,
                                    content: '<a href="' + _uri.replace(/([^/]+)\/$/, '') + '">..</a>'
                                        + files.map(
                                            function(a) {
                                                return '<br><a href="' + _uri + encodeURIComponent(a)  + '">' + a + '</a></li>';
                                            }
                                        ).join('')
                                }); 
                                res.writeHead(200, {'Content-Type': 'text/html'});
                                res.end(html);
                            });
                        }
                        else {
                            if (/\/$/.test(uri)) {
                                return err404();
                            }

                            if (stats.isFile()) {
                                return sendFile(path, stats);
                            }

                            err403();
                        }
                    });
                });
            });
        }).listen(self.port, self.host);
        
        console.log('Server running at http://%s:%s/', self.host, self.port);
    };

    setProperties();
    loadMimeTypes();
};