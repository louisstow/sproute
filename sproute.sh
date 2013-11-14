echo $MY_PATH
echo $0
WD="$(pwd)"

case "$1" in
"init")
	echo "init"
		mkdir views
		mkdir models
		echo "{}" > config.json
		echo "{}" > controller.json	
		echo "{}" > permissions.json	
	;;

"serve" | "s")
	node ./sproute
	;;

"modules")
	cd sproute/
	npm install 
	;;

"link")
	MY_PATH="`dirname \"$0\"`"
	MY_PATH="`( cd \"$MY_PATH\" && pwd )`"

	if [ -z "$MY_PATH" ] ; then
		echo "Link destination not found"
		exit 1
	fi

	rm /usr/local/bin/sproute
	ln -s $MY_PATH/sproute.sh /usr/local/bin/sproute
	;;

esac
