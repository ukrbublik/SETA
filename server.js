/**
 * Simulteneous Editable TextArea - Server
 */

var express = require('express');
var http = require('http');
var fs = require('fs');
var socketio = require('socket.io');
var appConfig = require("configure");
var diffUtil = require('./lib/diff_match_patch/diff_match_patch_uncompressed');
var diff3Util = require('./lib/synchrotron/diff');
var sem = require('semaphore');
var app = express();
var server = http.Server(app);
diffUtil = new diffUtil.diff_match_patch();
diff3Util = diff3Util.Diff;

app.get('/', function(req, res){
    fs.readFile("client/index.html", 'utf-8', function(error, data) {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.write(data);
        res.end();
    });
});
app.use(express.static('client'));

server.listen(appConfig.serverPort, function(){
	console.log('Listening on port ' + appConfig.serverPort);
});

/**
 * Simulteneous Editable TextArea
 */
function SETA(server_) {
	var self = this;
	
	self.io = null;
	self.text = '';
	self.version = 0;
	self.semSave = null;
	
	//keeping diffs history for users that have old versions
	self.diffs = {};
	//keeping old versions for resolution of time conflicts;
	//when we know that no clients use old version, we can clear appropriate cache;
	//(or instead of this client can send full text always, but it's not good..)
	self.texts = {};
	//todo: clear this caches when it becomes garbage
	
	/**
	 * Calc diff between a & b in format:
	 * [ [<op>, <pos>, <str/len>], ... ]
	 *  where 
	 *   <op> - 1 for insert, -1 for delete, 
	 *   <pos> - position, 
	 *   <str> for op=1 - string to insert or <len> for op=-1 - length od data to delete
	 */
	self.diffLite = function(a, b) {
		var diff_res = diffUtil.diff_main(a, b);
		diffUtil.diff_cleanupSemantic(diff_res);
		var diff = [];
		var pos = 0;
		for(var i = 0 ; i < diff_res.length ; i++) {
			if(diff_res[i][0] != 0) {
				if(diff_res[i][0] > 0)
					diff.push([ diff_res[i][0], pos, diff_res[i][1] ]); // 1) del/ins, 2) pos, 3) str
				else
					diff.push([ diff_res[i][0], pos, diff_res[i][1].length ]); // 1) del/ins, 2) pos, 3) len
			}
			if(diff_res[i][0] >= 0) {
				pos += diff_res[i][1].length;
			}
		}
		return diff;
	}
	
	/**
	 * Apply diff to string t, return patched string
	 */
	self.applyDiff = function(t, diff) {
		for(i = 0 ; i < diff.length ; i++) {
			var op = diff[i][0];
			var pos = diff[i][1];
			var s = diff[i][2];
			if(op < 0) {
				t = t.substr(0, pos) + t.substr(pos + s);
			} else if(op > 0) {
				t = t.substr(0, pos) + s + t.substr(pos);
			}
		}
		return t;
	};
	
	/**
	 * Load text & version info from file
	 */
	self.load = function(loaded) {
		if(fs.existsSync(appConfig.file) && fs.existsSync(appConfig.metafile)) {
			fs.readFile(appConfig.file, 'utf8', function (err1, data1) {
				if (err1)
					throw ("Can't load text file: " + err1);
				else {
					fs.readFile(appConfig.metafile, 'utf8', function (err2, data2) {
						if (err2)
							throw ("Can't load meta file: " + err2);
						else {
							var meta = JSON.parse(data2);
							if(!meta)
								throw ("Can't parse meta file");
							self.text = data1;
							self.version = meta.version;
							self.texts[self.version] = self.text;
							self.diffs = {};
							console.log('[i] Loaded version=', self.version);
							loaded();
						}
					});
				}
			});
		} else {
			self.text = '';
			self.version = 1;
			self.texts[self.version] = self.text;
			self.diffs = {};
			self.save(function() {
				console.log('loaded version=', self.version);
				loaded();
			});
		}
	};
	
	/**
	 * Save text & version info to file
	 */
	self.save = function(saved) {
		var meta = {
			version: self.version
		};
		fs.writeFile(appConfig.file, self.text, function(err1) {
			if(err1)
				throw ("Can't write text file: " + err1);
			fs.writeFile(appConfig.metafile, JSON.stringify(meta), function(err2) {
				if(err2)
					throw ("Can't write meta file: " + err2);
				saved();
			});
		});
	};
	
	/**
	 * Init
	 */
	self.init = function(serv) {
		self.load(function() {
			//Semaphore for safe saving data
			self.semSave = new sem(1);
			self.io = new socketio(serv);
			
			self.io.on('connection', function(socket) {
				console.log('[s]', socket.id, 'connection');
				socket.date_start = new Date();
				
				/**
				 * On client asks full text/changes
				 */
				socket.on('get_version', function(data) {
					console.log('[s]', socket.id, "get_version", data);
					if(data.fromServerVersion == 0 && self.version > 0) {
						//client asks full text
						socket.emit('got_version', {
							serverVersion: self.version,
							text: self.text
						});
					} else if (data.fromServerVersion > 0 && self.version > data.fromServerVersion) {
						//provide client with changes
						var diffs = {};
						for(var v = data.fromServerVersion ; v < self.version ; v++) {
							if(self.diffs[v] !== undefined)
								diffs[v] = self.diffs[v];
							else
								throw ("Missing diff for version " + v); //Client must reconnect
						}
						socket.emit('got_diffs', {
							fromServerVersion: data.fromServerVersion,
							serverVersion: self.version,
							diffs: diffs
						});
					} else if(data.fromServerVersion == self.version) {
						//client have latest, nothing to do
					} else {
						throw ("Can't be! self.version = " + self.version + ", data.version = " + data.fromServerVersion);
					}
				});
				
				/**
				 * On client made change
				 */
				socket.on('set_diffs', function(data) {
					console.log('[s]', socket.id, "set_diffs", data);
					self.semSave.take(function() {
						if(self.version == data.fromServerVersion) {
							//easy - client was synced to latest server version
							var t = self.text;
							t = self.applyDiff(t, data.diff);
							self.text = t;
							self.diffs[self.version] = data.diff;
							self.version++;
							self.texts[self.version] = self.text;
							//broadcast to others & confirm sender about new version
							var diffs = {};
							diffs[self.version - 1] = data.diff;
							socket.broadcast.emit('got_diffs', {
								fromServerVersion: self.version - 1,
								serverVersion: self.version,
								diffs: diffs,
							});
							socket.emit('got_diffs_back', {
								fromServerVersion: self.version - 1,
								serverVersion: self.version,
								localVersion: data.localVersion,
							});
							self.save(function() {
								self.semSave.leave();
							});
						} else if(data.fromServerVersion == 0) {
							console.log('[!]', 'client started to work with non-inited version!');
							self.semSave.leave();
							socket.emit('got_version', {
								serverVersion: self.version,
								text: self.text
							});
						} else if(self.version > data.fromServerVersion) {
							//if(data.fromServerVersion == 0)
							//	console.log('[!]', 'client started to work with non-inited version!');
							console.log('[!]', 'time conflict!');
							//time conflict! two clients sended their own updates to same version (or not same - it's even worse)
							var o = false; //source server's version, from which 2 clients started editing
							if(data.fromServerVersion == 0)
								o = '';
							else if(self.texts[data.fromServerVersion] !== undefined)
								o = self.texts[data.fromServerVersion];
							else if(data.textBefore !== undefined)
								o = data.textBefore;
							if(o !== false) {
								var a = self.text; //commited edited version from other (1st) client
								//apply diff (o -> b)
								var b = self.applyDiff(o, data.diff); //edited version from current (2st) client
								//do 3-way merge of o -> a, o -> b
								var m = diff3Util.diff3_merge(a, o, b, true);
								var r = '';
								var resolveStrategy = appConfig.threeWayMergeConflictResolveStrategy;
								//if(data.isAlreadyDirty)
								//	resolveStrategy = 'a';
								for(var i = 0 ; i < m.length ; i++) {
									if(m[i].ok !== undefined)
										r = r + m[i].ok.join('');
									else if(m[i].conflict !== undefined) {
										//we've got conflict!
										switch(resolveStrategy) {
											case 'o':
												r = r + m[i].conflict.o;
											break;
											case 'a':
												r = r + m[i].conflict.a;
											break;
											case 'b':
											default:
												r = r + m[i].conflict.b;
											break;
										}
									}
								}
								console.log('[i]', "resolved with strategy " + resolveStrategy + ": a=", a, 'o=', o, 'b=', b, 'r=', r, 'm=', m);
								var diffA = self.diffLite(a, r);
								var diffB = self.diffLite(b, r);
								self.text = r;
								self.diffs[self.version] = diffA;
								self.version++;
								self.texts[self.version] = self.text;
								//broadcast diffA to others & diffB to current client
								var diffs = {};
								diffs[self.version - 1] = diffA;
								socket.broadcast.emit('got_diffs', {
									fromServerVersion: self.version - 1,
									serverVersion: self.version,
									diffs: diffs,
								});
								var diffs = {};
								diffs[data.fromServerVersion] = diffB;
								socket.emit('got_diffs_back', {
									fromServerVersion: data.fromServerVersion,
									serverVersion: self.version,
									localVersion: data.localVersion,
									diffs: diffs,
								});
								self.save(function() {
									self.semSave.leave();
								});
							} else
								throw ("Missing text version " + data.fromServerVersion); //Client must reconnect
						} else {
							//can't be
							self.semSave.leave();
						}
					});
				});
				
				/**
				 * On disconnect
				 */
				socket.on('disconnect', function(){
					console.log('[s]', socket.id, 'disconnect');
					socket.date_end = new Date();
				});
				
				/**
				 * Error handling
				 */
				socket.on('error', function(err) {
					console.log('[s]', socket.id, 'error', err);
					socket.emit('app_error', err);
				});
			});
		});
	};
	
	self.init(server_);
	return self;
}

new SETA(server);

