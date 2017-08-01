var config = {
	"serverPort" : (process.env.PORT ? process.env.PORT : 8081),
	"file": "data/text.txt",
	"metafile": "data/meta.json",
	"threeWayMergeConflictResolveStrategy": "b"
};

module.exports = config;
