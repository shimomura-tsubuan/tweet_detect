//参考にさせていただいたURL： https://qiita.com/nobu09/items/c940fc6e0d67ef1cbc85
var slackWebhookUrl = 'https://hooks.slack.com/services/******/***********/**********';

var twitter_api_key = '****';
var twitter_api_key_secret = '****';

function call_main(){
  try {
    main()
  }
  catch(e){
    errMsg = e.toString()
    var err_count = PropertiesService.getScriptProperties().getProperty("err_count");
    err_count++

    //何回もSlack通知することを避けるためしきい値に達したときだけSlack通知する
    if ( err_count == notice_threshold ){
      postSlack("[ERROR]" + errMsg)
      PropertiesService.getScriptProperties().setProperty("status", "error"); //エラー通知した旨のステータスを記録しておく
      return
    }
    return
  }
  
  //ステータスを更新
  var status = PropertiesService.getScriptProperties().getProperty("status");
  if ( status == "error" ){
    postSlack("エラーから復帰しました")
  }
  PropertiesService.getScriptProperties().setProperty("status", "ok"); //正常終了したことを記録しておく。
  PropertiesService.getScriptProperties().setProperty("err_count", 0); //エラーカウントをリセットする
}

function main(){
  var check_range = new Date();
  var check_range = check_range.setMinutes(check_range.getMinutes() - 30); //Tweet検索対象の分数を指定
  
  //スプレッドシートの情報を抽出
  var ｓpreadSheetObject = SpreadsheetApp.getActiveSpreadsheet(); //現在アクティブなスプレッドシートを定義
  //「SaaSリスト」シート
  var list_sheetObject = ｓpreadSheetObject.getSheetByName('SaaSリスト'); //シート名を定義
  var list_sheetArray = list_sheetObject.getDataRange().getValues(); // シートの情報を全て二次元配列に保管
  //「検知文言」シート
  var downlist_sheetObject = ｓpreadSheetObject.getSheetByName('検知文言'); //シート名を定義
  var downlist_sheetArray = downlist_sheetObject.getDataRange().getValues(); // シートの情報を全て二次元配列に保管
  //「無視文言」シート
  var ignore_list_sheetObject = ｓpreadSheetObject.getSheetByName('無視文言'); //シート名を定義
  var ignore_list_sheetArray = ignore_list_sheetObject.getDataRange().getValues(); // シートの情報を全て二次元配列に保管
  
  //「無視文言」シートから除外対象のTweet文言を抽出する
  var ignore_regexp = return_ignore_regexp(ignore_list_sheetArray);
  //スプレッドシートからTwitterの検索ログを抽出
  for(var i=1; i<list_sheetArray.length; i++){ //1行目は無視する。
    var result_array = [];
    var search_key_1 = list_sheetArray[i][0]; //「SaaSリスト」シートのA列から抽出
    var threshold = list_sheetArray[i][1]; //「SaaSリスト」シートのB列から抽出
    
    //「SaaSリスト」シートから抽出した内容と「down_keyword」シートの内容をmergeしてTwitterから検索
    for(var j=0; j<downlist_sheetArray.length; j++){
      var search_key_2 = downlist_sheetArray[j][0];
      var result_array = searchTweetsApps(result_array, search_key_1, search_key_2, check_range, ignore_regexp);
      Utilities.sleep(100);
    }

    //エラー対策
    if ( result_array == undefined ) { result_array = ["NULL"] }; //ヒットしなかった時用
    var bool_1 = ( search_key_1 != "" ) && ( search_key_1 != undefined ); //スプレッドシートのセルが空欄だった時用(空欄ならfalseにする)
    var bool_2 = ( search_key_2 != "" ) && ( search_key_2 != undefined );  //スプレッドシートのセルが空欄だった時用(空欄ならfalseにする)
    
    //検索日時の範囲に該当したログが指定件数以上あればSlack通知(1件だけのtweetとかだと誤検知の可能性もあるので)
    var postNum = 5; //Slack通知する上限メッセージ数
    if ( result_array.length > (threshold-1) && bool_1 && bool_2){
      var summary_text = "「" + search_key_1 + "」で" + result_array.length + "件ヒットしました。(直近の" + String(postNum) + "件のみSlack通知します)";
      postSlack(summary_text);
      for(var k=0; k<result_array.length; k++){
        postSlack(result_array[k]);
        if (k==(postNum-1)){ break; }
      }
    }
  }
}

function searchTweetsApps(result_array, app_name, detect_word, check_range, ignore_regexp) {
  //引数
  //arg1: 条件一致したTweet文を格納しておく配列
  //arg2: Twitter検索したいSaaS名
  //arg3: arg1に加えてand条件で検索したいキーワード
  //arg4: 投稿日時の検知範囲
  //arg5: 無視文言の正規表現パターンを指定
  
  if ( app_name == "" || app_name == undefined ) { return };
  if ( detect_word == "" || detect_word == undefined ) { return };
  // ①Twitter Bearerトークンの取得（検索APIの呼び出しに必要）
  // POST oauth2/token  https://developer.twitter.com/en/docs/basics/authentication/api-reference/token
  var blob = Utilities.newBlob(consumer_key + ':' + consumer_secret);
  var credential = Utilities.base64Encode(blob.getBytes());

  var formData = {
    'grant_type': 'client_credentials'
  };

  var basic_auth_header = {
    'Authorization': 'Basic ' + credential
  };

  var options = {
    'method': 'post',
    'contentType': 'application/x-www-form-urlencoded;charset=UTF-8',
    'headers':  basic_auth_header,
    'payload': formData,
  };

  var oauth2_response = UrlFetchApp.fetch('https://api.twitter.com/oauth2/token', options);  
  var bearer_token = JSON.parse(oauth2_response).access_token; 

  // ②Twitter 検索APIの呼び出し 
  // GET https://api.twitter.com/1.1/search/tweets.json
  var bearer_auth_header = {
    'Authorization': 'Bearer ' + bearer_token
  };
  
  //Twitter検索
  //var search_keyword = app_name + " -RT lang:ja";
  var search_keyword = app_name + " " + detect_word + " -RT lang:ja";
  var search_response = UrlFetchApp.fetch(
    'https://api.twitter.com/1.1/search/tweets.json?q=' + search_keyword + '&lang=ja&result_type=recent&count=100',
    { 'headers': bearer_auth_header });
  var result = JSON.parse(search_response);
  
  //var result2 = []; //検索日時の範囲に合致するやつを格納する箱
  result.statuses.forEach(function(status) {
    var tweet_text = status.text;
    var tweet_date = new Date(status.created_at);
    var user_name = status.user.name;
    
    //Tweet文に求めている文言が含まれているか確認
    //検索用の正規表現作成しとく
    var app_name_regexp = new RegExp(".*" + app_name.toLowerCase() + ".*");
    var detect_word_regexp = new RegExp(".*" + detect_word.toLowerCase() + ".*");
    //Tweet文を精査
    var tweet_text_2 = tweet_text.toLowerCase(); //tweet文言を小文字に変換しとく。
    var bool_1 = app_name_regexp.test(tweet_text_2);
    var bool_2 = detect_word_regexp.test(tweet_text_2);
    var bool_3 = ( ! ignore_regexp.test(tweet_text_2) );
    
    //精査結果にマッチ かつ 検知範囲にマッチするものを抽出。
    if ( check_range < tweet_date && bool_1 && bool_2 && bool_3 ) {
      var jst = Utilities.formatDate(new Date(tweet_date), "JST", "yyyy/MM/dd HH:MM")
      var tweet_data = "*" + user_name + "(" + jst + ")" + "*" + "\n";
      var tweet_data = tweet_data + "```" + tweet_text + "```";
      result_array.push(tweet_data)
    }
  });
  
  return result_array;
}

function postSlack(text){
  var data = {
    "text": text
  }
  var options = {
    'method' : 'post',
    'contentType': 'application/json',
    'payload' : JSON.stringify(data)
  };
  UrlFetchApp.fetch(slackWebhookUrl, options);
}

function return_ignore_regexp(ignore_list_sheetArray){
  //「無視文言」リストに記載のある内容に.*を前後につける
  var temp_array = []
  for(var i=0; i<ignore_list_sheetArray.length; i++){
    var ignore_word = ignore_list_sheetArray[i][0];
    if ( ignore_word != "" && ignore_word != undefined ){
      var ignore_word = ".*" + ignore_list_sheetArray[i][0] + ".*";
      temp_array.push(ignore_word)
    }
  }
  
  //「|」で連結する。(空の場合はダミーの文字列を入れとく)
  var temp_array_join = temp_array.join("|");
  if ( temp_array_join == "" ){
    var temp_array_join = "_N_U_L_L_";
  }
  //正規表現オブジェクトにして返す
  var regexp = new RegExp(temp_array_join);
  return regexp
}