//npm run build
//serverless deploy -v -s dev 
import { Handler, Context, Callback } from 'aws-lambda';
import AWS, { Lambda, config } from 'aws-sdk';
import { RequestOptions, request } from 'https';
import path from 'path';
import moment from 'moment-timezone';
import { Parser } from 'xml2js';

interface DigestStrings {
  app: string,
  project: string,
  plan: string,
  passage: string,
  state: string,
  user: string,
  comments: string,
  preferences: string,
  sil: string,
  subject: string,
}
interface ActivityStateStrings {
  approved: string,
  done:string,
  incomplete: string,
  needsNewRecording: string,
  needsNewTranscription: string,
  noMedia: string,
  review: string,
  reviewing: string,
  synced: string,
  transcribe: string,
  transcribed: string,
  transcribeReady: string,
  transcribing: string
}
interface EmailStrings {
  digest: DigestStrings,
  activityState: ActivityStateStrings
}

interface IDataAttributes {
  projectid: number,
  project: string,
  organizationid: number
  organization: string,
  planid: number,
  plan: string,
  plantype: string,
  transcriber: string,
  reviewer: string,
  passage: string,
  state: string,
  modifiedby: string,
  updated: Date,
  email: string,
  timezone: string,
  locale: string,
  comments: string,
}
interface IDataRow {
  attributes: IDataAttributes,
  type: string,
  id: number
}
const handler: Handler = (event: any, context: Context, callback: Callback) => {

  const host: string = getEnvVarOrThrow(process.env.SIL_TR_HOST);
  const stagepath: string = getEnvVarOrThrow(process.env.SIL_TR_URLPATH);
  const EnglishStrings : EmailStrings = 
  {
    digest: {
      app: "Audio Project Manager",
      project: "Project",
      plan: "Plan",
      passage: "Passage",
      state: "Change",
      user: "User",
      comments: "Comments",
      preferences: "Change communication preferences",
      sil: "SIL International",
      subject: "Daily Digest of Audio Project Manager Activity",
    },
    activityState: {
      approved: "Approved",
      done:"Done",
      incomplete: "Incomplete",
      needsNewRecording: "Needs New Recording",
      needsNewTranscription:  "Needs New Transcription",
      noMedia: "No Media",
      review: "Ready to Review",
      reviewing: "Reviewing",
      synced: "Synced",
      transcribe: "Transcribe",
      transcribed: "Transcribed",
      transcribeReady: "Ready to Transcribe",
      transcribing: "Transcribing"
    }
  }

  function getEnvVarOrDefault(value: string | undefined, def: string): string {
    return value === undefined ? def : value;
  }
  function getEnvVarOrThrow(value: string | undefined): string {
    if (value === undefined)
      throw new Error("Undefined environment variable");
    return value;
  }
  function _format(str: string, arr: string[]) {
    return str.replace(/{(\d+)}/g, function (match, number) {
      return typeof arr[number] != 'undefined' ? arr[number] : match;
    });
  };
  function stageToProgram(): string {
    switch (stagepath)
    {
      case '/prod':
        return ''; 
      default:
        return stagepath.replace("/", "-").substring(0,4);
    }
  }

  function XMLtoJS(xmlStr: string): Promise<any> 
  {
    return new Promise((resolve, reject) => {
      var parser = new Parser();
       parser.parseString(xmlStr, function (err: any, result: any) {
        if (err !== null) {
          console.log("XMLtoJS error", err);
          reject(err);
        }
        else {
          //console.dir(result);
          //console.log('XMLtoJS Done');
          resolve(result);
        }
      });
    });
  }

/*
  function displayObj(obj: any, level: number) {
    console.log(level, Object.keys(obj))
    /*
    Object.keys(obj).forEach(e => {
      console.log(level, `key=${e}  value=${obj[e]}`);
      if (typeof (obj[e]) === 'object')
        displayObj(obj[e], level + 1);
    });
    */
  //} 
  
  
  async function ReadStrings(locale: string)
  {
    const BUCKET = 'sil-transcriber-localization'
    const DIGEST = '/TranscriberDigest-en.xliff'
    var params = {Bucket: BUCKET, Key: locale + DIGEST};
    //console.log('ReadStrings', params.Key);
    try {
      var s3 = new AWS.S3();
      const xml_data = await s3.getObject(params).promise();
      return xml_data?.Body?.toString() ;
    } catch (err) {
        console.log('ReadStrings error:', params.Key);
        if ((err as any).code !== 'NoSuchKey')
          console.log('ReadStrings', err);
        //use default english
        return undefined;
    }
}
function encodeStr(str:string) {return str.replace(/[\u00A0-\u9999<>\&]/g, function(i) {
  return '&#'+i.charCodeAt(0)+';';
})};

  async function UserStrings(locale: string): Promise<any> {
    console.log('locale:', locale);
    var localStrs = {digest: {...EnglishStrings.digest}, activityState: {...EnglishStrings.activityState}}
    var strings = (locale !== 'en') ? await ReadStrings(locale) : undefined;
    if (strings)
    { 
      const data = await XMLtoJS(strings);
      var js = data;
      for (var ix = 0; ix < js.xliff.file[0].body[0]['trans-unit'].length; ix++) {
        //console.log(ix, 
        //js.xliff.file[0].body[0]['trans-unit'][ix]['$'].id, 
        //js.xliff.file[0].body[0]['trans-unit'][ix].target[0]['_']);
        var ids = js.xliff.file[0].body[0]['trans-unit'][ix]['$'].id.split('.');
        if (ids[0] === 'digest') {
          //encode all but subject
          localStrs.digest[ids[1] as keyof DigestStrings] = js.xliff.file[0].body[0]['trans-unit'][ix].target[0]['_'];
          if (ids[1] !== 'subject') localStrs.digest[ids[1] as keyof DigestStrings] = encodeStr(localStrs.digest[ids[1] as keyof DigestStrings]);
        }
        else
          localStrs.activityState[ids[1] as keyof ActivityStateStrings] = encodeStr(js.xliff.file[0].body[0]['trans-unit'][ix].target[0]['_']);
      }
    }
    return localStrs;
  }

  function getChanges(since: string): Promise<any> {
    return new Promise((resolve, reject) => {
      // options for API request
      const options: RequestOptions = {
        host: host,
        path: stagepath + "/api/statehistories/since/" + since,
        method: "GET"
      };
      console.log(host + options.path);
      const req = request(options, res => {
        console.log(res.statusCode);
        if (res.statusCode != 200) {
          //not found
          reject(res.statusCode);
          res.on("data", (d: string) => {
            console.log(d);
          });
        }
        else {
          let data: any[] = [];
          res.on("data", (chunk: Buffer) => {
            data.push(chunk);
          }).on('end', () => {
            resolve(JSON.parse(Buffer.concat(data).toString()).data);
          });

        }
      });
      req.on("error", (e: Error) => {
        console.log("getChanges error:", e);
        reject(e);
      });
      req.end();
    });
  }

  function readFile(name: string): string {
    var fs = require('fs');
    let reqPath = path.join(__dirname, name);
    return fs.readFileSync(reqPath, 'utf8');
  }
  function buildRow(row: IDataRow, strings:EmailStrings): string {
    return row_html
      .replace("{Passage}", row.attributes.passage)
      .replace("{State}", strings.activityState[row.attributes.state as keyof ActivityStateStrings]  || row.attributes.state)
      .replace("{Change}", row.attributes.modifiedby)
      .replace("{Comment}", row.attributes.comments || '')
  }

  function localizeColumnHeaders(strings: EmailStrings): string {
    return headers_html.replace("{{Passage}}", strings.digest.passage)
      .replace("{{State}}",strings.digest.state)
      .replace("{{Change}}", strings.digest.user)
      .replace("{{Comments}}", strings.digest.comments);
  }
  function buildProjPlan(data: IDataRow[], strings: EmailStrings): string {
    var contents: string = "";
    var row;
    for (row of data) {
      contents += buildRow(row, strings);
    }

    var template = "http://app{0}.audioprojectmanager.org/plan/{1}/3";

    var link = _format(template, [stageToProgram(),
    //data[0].attributes.organizationid.toString(),
    //data[0].attributes.plantype.toLowerCase(),
    //data[0].attributes.projectid.toString(),
    data[0].attributes.planid.toString()]);
    return projplan_html
      .replace("{projplanlink}", link)
      .replace("{ProjPlan}", data[0].attributes.plan)
      .replace("{{headers}}", localizeColumnHeaders(strings))
      .replace("{datarows}", contents);
  }
  function buildHour(data: IDataRow[], strings: EmailStrings): string {
    var contents: string = "";
    var curProj: string = data[0].attributes.project;
    var curPlan: string = data[0].attributes.plan;
    var row;
    var start: number = 0;
    var end: number = 0;
    for (row of data) {
      if (row.attributes.project != curProj ||
        row.attributes.plan != curPlan) {
        contents += buildProjPlan(data.slice(start, end), strings);
        start = end;
        curProj = row.attributes.project;
        curPlan = row.attributes.plan;
      }
      end = end + 1;
    }
    contents += buildProjPlan(data.slice(start, end), strings);
    var utc = moment(data[0].attributes.updated);
    var local = data[0].attributes.timezone ?
      utc.clone().tz(data[0].attributes.timezone) : utc.clone();
    return hour_html
      .replace("{Hour}", local.format('ha z'))
      .replace("{projplanrows}", contents);
  }
  function buildDay(data: IDataRow[], strings: EmailStrings): string {
    var contents: string = "";
    const curDate = new Date(data[0].attributes.updated);
    var curHour = curDate.getHours();
    var rowHour: number;
    var row;
    var start: number = 0;
    var end: number = 0;
    for (row of data) {
      rowHour = (new Date(row.attributes.updated)).getHours();
      if (rowHour != curHour) {
        contents += buildHour(data.slice(start, end), strings);
        start = end;
        curHour = rowHour;
      }
      end = end + 1;
    }
    contents += buildHour(data.slice(start, end), strings);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } as Intl.DateTimeFormatOptions;

    return date_html
      .replace("{Date}", curDate.toLocaleDateString(data[0].attributes.locale ? data[0].attributes.locale : 'en-US', options))
      .replace("{hourrows}", contents);
  }
  function buildEmailNHE(data: IDataRow[], strings: EmailStrings): string {
    var contents: string = "";
    var curDay: number = (new Date(data[0].attributes.updated)).getUTCDay();
    var row;
    var rowDay: number;
    var start: number = 0;
    var end: number = 0;
    for (row of data) {
      rowDay = (new Date(row.attributes.updated)).getUTCDay();
      if (rowDay != curDay) {
        contents += buildDay(data.slice(start, end), strings);
        start = end;
        curDay = rowDay;
      }
      end = end + 1;
    }
    contents += buildDay(data.slice(start, end), strings);
    return main_html
      .replace("{{App}}", strings.digest.app)
      .replace("{{Subject}}", encodeStr(strings.digest.subject))
      .replace("{daterows}", contents)
      .replace("{{Preferences}}", strings.digest.preferences)
      .replace("{ProfileLink}", _format("https://app{0}.audioprojectmanager.org/profile", [stageToProgram()]))
      .replace("{Year}", (new Date()).getFullYear().toString())
      .replace("{{SIL}}",strings.digest.sil);
  }
  async function sendEmail(to: string, body: string, subject: string) {
    const from: string = getEnvVarOrThrow(process.env.SIL_TR_FROM_EMAIL);
    const captureTo: string = stagepath.substring(0, 4) == "/dev" ? "sara_hentzel@wycliffe.org" : to;
    //console.log(to, captureTo !== to ? captureTo : '');
    var payload = {
      ToAddresses: [captureTo],
      BodyHtml: body,
      Subject: subject + (captureTo === to ? '' : ":: " + to),
      FromEmail: from
    }
    var params = {
      FunctionName: 'SendSESEmail', // the lambda function we are going to invoke
      InvocationType: 'Event', // 'RequestResponse', //'Event', // 
      LogType: 'Tail',
      Payload: JSON.stringify(payload)
    };
    config.region = 'us-east-1';
    const lambda = new Lambda();

    lambda.invoke(params, function (err, data) {
      if (err) {
        console.log('SendSESEmail', to, err);
        context.fail(err);
      } else {
        console.log('SendSESEmail',to, "Success");
        //context.succeed('SendSES said ' + data.Payload);
      }
    })
  }

  try {
    const minutes: number = parseInt(getEnvVarOrDefault(process.env.SIL_TR_NOTIFYTIMEMINUTES, "1440"));
    const now: number = Date.now();
    const since: Date = (new Date(now - (minutes * 60 * 1000)));
    var main_html = readFile('templates/main.layout.hbs');
    var date_html = readFile('templates/date.partial.hbs');
    var projplan_html = readFile('templates/projplan.partial.hbs');
    var hour_html = readFile('templates/hour.partial.hbs');
    var headers_html = readFile('templates/headers.partial.hbs');
    var row_html = readFile('templates/row.partial.hbs');

    getChanges(since.toISOString()).then(async function (data: IDataRow[]) {
      console.log("getChanges", data.length);
      if (data.length > 0) {
        var email: string = data[0].attributes.email;
        var locale: string = data[0].attributes.locale ?? "en";
        var start: number = 0;
        var end: number = 0;
        var strings: EmailStrings = await UserStrings(locale); 
        var row: any;
        for (var ix = 0; ix < data.length; ix++) {
          row = data[ix];
          if (row.attributes.email != email) {
              console.log("send to ", email, strings.digest.subject, start, end - 1);
              sendEmail(email,
                  buildEmailNHE(data.slice(start, end), strings), strings.digest.subject);
            
            start = end;
            email = row.attributes.email
            if (locale != row.attributes.locale)
            {
              locale = row.attributes.locale ?? "en";
              strings = await UserStrings(locale); 
            }
          }
          end = end + 1;
        } 
          console.log("send to ", email, strings.digest.subject, start, end - 1);
          sendEmail(email,
            buildEmailNHE(data.slice(start, end), strings), strings.digest.subject);
          
      }
    }, function (err) { console.log('getChanges', err) });

  } catch (e) {
    console.log("catch");
    console.log(e);
    callback(e as Error, undefined);
  }
};

export { handler }
