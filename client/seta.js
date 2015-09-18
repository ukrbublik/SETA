/**
 * Simulteneous Editable TextArea - Client
 */
function SETA(params_) {
	var self = this;
	
	self.url = null;
	self.socket = null;
	self.diffUtil = null;
	
	//textarea object
	self.$ta = null;
	//value in textarea before each change, to detect diff
	self.textBefore = '';
	//current value in textarea
	self.text = '';
	//text in textarea before user made changes that are not yet commited (start point)
	self.textBeforeLocalChanges = '';
	//server version of text
	self.serverVersion = 0;
	//local version, incremented on each user change; has nothing to do with real server version!
	self.localVersion = 0;
	//latest local version that was commited to server
	self.commitedLocalVersion = 0;
	self.send_diffs_queue = [];
	
	self.callbacks = {};
	
	/**
	 * Calc diff between a & b in format:
	 * [ [<op>, <pos>, <str/len>], ... ]
	 *  where 
	 *   <op> - 1 for insert, -1 for delete, 
	 *   <pos> - position, 
	 *   <str> for op=1 - string to insert or <len> for op=-1 - length od data to delete
	 */
	self.diffLite = function(a, b) {
		var diff_res = self.diffUtil.diff_main(a, b);
		self.diffUtil.diff_cleanupSemantic(diff_res);
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
	 * Updates text and input position of textarea object
	 */
	self.updateTA = function(diff) {
		var selBefore = [ self.$ta.get(0).selectionStart, self.$ta.get(0).selectionEnd ];
		var sel = selBefore;
		if(diff) {
			for(i = 0 ; i < diff.length ; i++) {
				var op = diff[i][0];
				var pos = diff[i][1];
				var s = diff[i][2];
				if(op < 0) {
					var del = [ pos, pos + s ];
					if(del[1] < sel[0]) {
						//before
						sel[0] -= s;
						sel[1] -= s;
					} else if(del[0] > sel[1]) {
						//after
					} else if(del[0] < sel[0] && del[1] > sel[1]) {
						//full
						sel = [-1, -1];
						break;
					} else if(del[0] > sel[0] && del[1] < sel[1]) {
						//part
						sel[0] += (del[0] - sel[0]);
						sel[1] -= (sel[1] - del[1]);
					} else {
						//overlap
						if(sel[0] > del[0]) {
							sel[0] -= (sel[0] - del[0]);
							sel[1] -= (sel[0] - del[0]);
							sel[1] -= (del[1] - sel[0]);
						} else {
							sel[1] -= (sel[1] - del[0]);
						}
					}
				} else {
					if(pos < sel[0]) {
						sel[0] += s.length;
						sel[1] += s.length;
					} else if(pos > sel[1]) {
					} else if(sel[0] != sel[1]) {
						sel[1] += s.length;
					}
				}
			}
		}
		self.$ta.val(self.text);
		if(selBefore != sel)
			self.$ta.get(0).setSelectionRange(sel[0], sel[1]);
	};
	
	/**
	 * Init
	 */
	self.init = function(params) {
		if(typeof io === 'undefined')
			throw "socket.io not loaded";
		if(typeof diff_match_patch === 'undefined')
			throw "diff_match_patch not loaded";
		if(!params)
			throw "No params";
		if(!params.$ta)
			throw "No textarea object";
		if(!params.url)
			throw "No connection url";
		if(params.callbacks)
			self.callbacks = params.callbacks;
		
		self.$ta = params.$ta;
		self.url = params.url;
		self.diffUtil = new diff_match_patch();
		
		self.clear();
		self.reconnect();
		
		/**
		 * On user changes text
		 */
		self.$ta.on('input', function(e) {
			self.text = e.target.value;
			var diff = self.diffLite(self.textBefore, self.text);
			if(diff) {
				//isAlreadyDirty=1 means client is making > 1 changes that are not commited yet
				var isAlreadyDirty = (self.isDirty() ? 1 : 0);
				if(!self.isDirty()) {
					self.textBeforeLocalChanges = self.textBefore;
				} else {
					//we need to send not latest diff, but diff relative to commited server's version (start point)
					diff = self.diffLite(self.textBeforeLocalChanges, self.text);
				}
				self.localVersion++;
				//send diff to server
				var data = {
					fromServerVersion: self.serverVersion,
					localVersion: self.localVersion,
					diff: diff,
					isAlreadyDirty: isAlreadyDirty
				};
				if(self.socket && self.socket.connected) {
					self.socket.emit('set_diffs', data);
					console.log(self.socket.id, '> set_diffs', data);
				} else {
					self.send_diffs_queue.push(data);
				}
				//now we're in dirty state, need confirmation from server - waiting for 'got_diffs_back' event
				if(self.callbacks.sent_diffs)
					self.callbacks.sent_diffs();
			}
			self.textBefore = self.text;
		});
	};
	
	/**
	 * Returns true if client made changes that are not all commited to server yet
	 */
	self.isDirty = function() {
		return (self.localVersion > self.commitedLocalVersion);
	};
	
	/**
	 * Reconnect socket
	 */
	self.reconnect = function() {
		self.disconnect();
		self.connect();
	};
	
	/**
	 * Clear all data about text and versioning
	 * Can be used with reconnecting, looses non-commited changes!
	 */
	self.clear = function() {
		self.text = self.textBefore = self.textBeforeLocalChanges = '';
		self.localVersion = self.commitedLocalVersion = self.serverVersion = 0;
		self.send_diffs_queue = [];
		self.updateTA();
		if(self.callbacks.cleared)
			self.callbacks.cleared();
	};
	
	/**
	 * Disconnect socket
	 */
	self.disconnect = function() {
		if(self.socket)
			self.socket.disconnect();
		self.socket = null;
	};
	
	/**
	 * Create socket and attach events callbacks
	 */
	self.connect = function() {
		self.socket = io.connect(
			self.url, {
				reconnection: true,
				reconnectionDelay: 1000, reconnectionDelayMax: 5000,
				timeout: 20000,
				forceNew: 1
		});
		
		/**
		 * On socket connect
		 */
		self.socket.on('connect', function() {
			console.log(self.socket.id, 'connect', self.$ta.attr('id'));
			
			if(self.isDirty()) {
				//self.clean();
			}
			
			if(self.isDirty()) {
				//send uncommited local changes and continue
				if(self.send_diffs_queue.length) {
					var data = self.send_diffs_queue.pop();
					self.socket.emit('set_diffs', data);
					self.send_diffs_queue = [];
				} else {
					/*
					//it's same, old one
					var diff = self.diffLite(self.textBeforeLocalChanges, self.text);
					self.socket.emit('set_diffs', {
						fromServerVersion: self.serverVersion,
						localVersion: self.localVersion,
						diff: diff,
						isAlreadyDirty: 1,
						textBefore: self.textBeforeLocalChanges
					});
					*/
				}
			} else {
				//get initial version
				self.socket.emit('get_version', {
					fromServerVersion: self.serverVersion
				});
			}
			
			if(self.callbacks.connected)
				self.callbacks.connected();
		});
		
		/**
		 * On got initial version (full text) to start work with
		 */
		self.socket.on('got_version', function(data) {
			console.log(self.socket.id, 'got_version', data);
			if(self.serverVersion == 0) {
				if(self.localVersion > 0) {
					console.warn("client started to work with non-inited version!");
				}
				self.text = self.textBefore = data.text;
				self.updateTA();
				self.serverVersion = data.serverVersion;
				self.localVersion = self.commitedLocalVersion = 1;
				self.send_diffs_queue = [];
			} else if(self.serverVersion > 0) {
				console.error("client already have server version " + self.serverVersion + ", but got " + data.serverVersion);
				//can't be but try to handle..
				self.clean();
				self.reconnect();
			}
			if(self.callbacks.got_version)
				self.callbacks.got_version();
		});
		
		/**
		 * On got respond after 'set_diffs' event about that changes were commited
		 */
		self.socket.on('got_diffs_back', function(data) {
			console.log(self.socket.id, 'got_diffs_back', data);
			if(data.fromServerVersion == self.serverVersion) {
				if(data.localVersion == self.localVersion) {
					if(data.diffs !== undefined) {
						//was time conflict
						var v = data.fromServerVersion;
						var t = self.applyDiff(self.text, data.diffs[v]);
						self.text = self.textBefore = t;
						self.updateTA(data.diffs[v]);
					}
					//now local & server versions are synchronized
					self.serverVersion = data.serverVersion;
					self.commitedLocalVersion = data.localVersion;
					self.textBeforeLocalChanges = '';
					self.send_diffs_queue = [];
				} else if(self.localVersion > data.localVersion) {
					//client made > 1 changes to some source version (probably offline), 
					// so ignore this responce until we'll got latest responce (for lastest change)
				}
			} else {
				console.error("client have server version " + self.serverVersion + ", but server responded on update from " + data.fromServerVersion);
				//can't be?
			}
			if(self.callbacks.got_diffs_back)
				self.callbacks.got_diffs_back();
		});
		
		/**
		 * On got other clients' changes
		 */
		self.socket.on('got_diffs', function(data) {
			console.log(self.socket.id, 'got_diffs', data);
			if(data.fromServerVersion == self.serverVersion) {
				if(!self.isDirty()) {
					for(var v = data.fromServerVersion ; v < data.serverVersion ; v++) {
						var t = self.applyDiff(self.text, data.diffs[v]);
						self.text = self.textBefore = t;
						self.updateTA(data.diffs[v]);
						self.serverVersion = v+1;
					}
				} else {
					//ignore, wait for commiting local changes
				}
			} else {
				console.error("client have server version " + self.serverVersion + ", but server responded on update from " + data.fromServerVersion);
				//can't be?
			}
			if(self.callbacks.got_diffs)
				self.callbacks.got_diffs();
		});
		
		/**
		 * On disconnect
		 */
		self.socket.on('disconnect', function() {
			console.log('disconnect');
			if(self.callbacks.disconnected)
				self.callbacks.disconnected();
		});
		
		/**
		 * Error handling
		 * Server closes socket so it's not usable - we must reconnect
		 */
		self.socket.on('app_error', function(err) {
			console.error(self.socket.id, 'app_error', err);
			if(self.callbacks.app_error)
				self.callbacks.app_error(err);
			else {
				self.reconnect();
				self.clear();
			}
		});
		
		
		self.socket.on('reconnect_attempt', function() { });
		self.socket.on('reconnecting', function(attempt_no) { });
		self.socket.on('reconnect', function(attempt_no) { });
		self.socket.on('reconnect_error', function(attempt_no) { });
		self.socket.on('reconnect_failed', function() { /* gived up? */ });
		self.socket.on('connect_error', function(err) { });
		self.socket.on('connect_timeout', function() { });
	}
	
	self.init(params_);
	return self;
};
