var config = {
	"serverPort" : (process.env.PORT ? process.env.PORT : 80),
	"file": "data/text.txt",
	"metafile": "data/meta.json",
	"threeWayMergeConflictResolveStrategy": "b"
};

module.exports = config;
