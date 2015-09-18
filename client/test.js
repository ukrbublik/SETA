
var seta1 = null;
var seta2 = null;
document.addEventListener("DOMContentLoaded", function(event) {
	seta1 = new SETA({
		'$ta': $('#ta1'),
		'url': 'http://' + window.location.hostname + ':1337',
		'callbacks': {
			'connected': function() { $('#stat1').text('connected') },
			'disconnected': function() { $('#stat1').text('disconnected') },
			'got_version': function() {},
			'sent_diffs': function() {},
			'got_diffs_back': function() {},
			'got_diffs': function() {},
			'cleared': function() {},
		}
	});
	seta2 = new SETA({
		'$ta': $('#ta2'),
		'url': 'http://' + window.location.hostname + ':1337',
		'callbacks': {
			'connected': function() { $('#stat2').text('connected') },
			'disconnected': function() { $('#stat2').text('disconnected') },
			'got_version': function() {},
			'sent_diffs': function() {},
			'got_diffs_back': function() {},
			'got_diffs': function() {},
			'cleared': function() {},
		}
	});
	
});

function testTimeConflict() {
	$('#ta1').val("--initial string--").trigger('input');
	setTimeout(function() {
		$('#ta1').val("[added first] --initial string--").trigger('input');
		$('#ta2').val("--initial string-- [added second]").trigger('input');
	}, 100);
}

function testTimeConflict1() {
	$('#ta1').val("the quick brown fox jumped over a dog").trigger('input');
	setTimeout(function() {
		$('#ta1').val("the quick fox jumps over some lazy dog").trigger('input');
		$('#ta2').val('the quick brown fox jumps over some record dog').trigger('input');
	}, 100);
}

function toggleOffline1() {
	if(seta1.socket && seta1.socket.connected)
		seta1.disconnect();
	else
		seta1.connect();
}
function toggleOffline2() {
	if(seta2.socket && seta2.socket.connected)
		seta2.disconnect();
	else
		seta2.connect();
	
}
