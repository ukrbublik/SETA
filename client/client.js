
var seta1 = null;
document.addEventListener("DOMContentLoaded", function(event) {
	seta1 = new SETA({
		'$ta': $('#ta1'),
		'url': 'http://' + window.location.hostname + ':1337',
	});
});


