import { Handler, Context, Callback } from 'aws-lambda';
import { Lambda, config } from 'aws-sdk';
import { RequestOptions, request } from 'https';
import path from 'path';
import moment from 'moment-timezone';
import { Parser } from 'xml2js';

interface EmailStrings {
  App: string,
  Project: string,
  Plan: string,
  Passage: string,
  State: string,
  Change: string,
  Comments: string,
  Preferences: string,
  SIL: string,
  Subject: string,
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
    if (stagepath === '/prod')
      return '';
    return stagepath.replace("/", "-");
  }
  function getLocalizedString(id: string, xmlDoc: any): string {
    return "This is it";
  }
  /*
  function getLocalizedFile(name: string, callback: any): void {
    var xhr = new XMLHttpRequest();
    xhr.onload = () => {
      let status = xhr.status;

      if (status == 200) {
        callback(null, xhr.responseXML);
      } else {
        callback(status, null);
      }
    };
    xhr.open("GET", name, true);
    xhr.send();

  } */
  function XMLtoJS(filename: string): Promise<any> {
    console.log("XMLtoJS");
    return new Promise((resolve, reject) => {
      var parser = new Parser();
      var xmlStr = readFile(filename);
      console.log(xmlStr);
      parser.parseString(xmlStr, function (err: any, result: any) {
        if (err !== null) {
          console.log("XMLtoJS error", err);
          reject(err);
        }
        else {
          console.dir(result);
          console.log('XMLtoJS Done');
          resolve(result);
        }
      });
    });
  }
  function displayObj(obj: any, level: number) {
    Object.keys(obj).forEach(e => {
      console.log(level, `key=${e}  value=${obj[e]}`);
      if (typeof (obj[e]) === 'object')
        displayObj(obj[e], level + 1);
    });
  }
  function UserStrings(locale: string): Promise<any> {
    return XMLtoJS('locales/TranscriberDigest-en.xliff').then(function (data: any) {
      var js = data;
      displayObj(js.xliff.file, 1);
      return {
        App: getLocalizedString("App", js),
        Project: getLocalizedString("Project", js),
        Plan: getLocalizedString("Plan", js),
        Passage: getLocalizedString("Passage", js),
        State: getLocalizedString("State", js),
        Change: getLocalizedString("User", js),
        Comments: getLocalizedString("Comments", js),
        Preferences: getLocalizedString("preferences", js),
        SIL: getLocalizedString("SIL", js),
        Subject: getLocalizedString("Subject", js),
      }

    });
  }

  /*
    getLocalizedFile('locales/TranscriberDigest-' + locale + '.xliff', (err: number | null, xmlDoc: XMLDocument | null) => {
      if (err != null || xmlDoc == null) {
        console.error("NO Document", err);
        reject(err);
      }
      else {
        console.log(xmlDoc.getElementById("App"));
        resolve({
          App: "SIL Transcriber",
          Project: "Project",
          Plan: "Plan",
          Passage: "Passage",
          State: "New State",
          Change: "User",
          Comments: "Comments",
          Preferences: "Change notification preferences",
          SIL: "SIL International",
          Subject: "My Digest of SIL Transcriber Activity",
        });
      }
    });
  }
  */



  function getUserStrings(locale: string): EmailStrings {
    return {
      App: "SIL Transcriber",
      Project: "Project",
      Plan: "Plan",
      Passage: "Passage",
      State: "Change",
      Change: "User",
      Comments: "Comments",
      Preferences: "Change communication preferences",
      SIL: "SIL International",
      Subject: "Daily Digest of SIL Transcriber Activity",
    }
  }

  function getChanges(since: string): Promise<any> {
    return new Promise((resolve, reject) => {
      // options for API request
      const options: RequestOptions = {
        host: host,
        path: stagepath + "/api/statehistory/since/" + since,
        method: "GET"
      };
      console.log(host + options.path);
      const req = request(options, res => {
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
  function buildRow(row: IDataRow): string {
    return row_html
      .replace("{Passage}", row.attributes.passage)
      .replace("{State}", row.attributes.state)
      .replace("{Change}", row.attributes.modifiedby)
      .replace("{Comment}", row.attributes.comments ? row.attributes.comments : '')
  }

  function localizeColumnHeaders(strings: EmailStrings): string {
    return headers_html.replace("{{Passage}}", strings.Passage)
      .replace("{{State}}", strings.State)
      .replace("{{Change}}", strings.Change)
      .replace("{{Comments}}", strings.Comments);
  }
  function buildProjPlan(data: IDataRow[], strings: EmailStrings): string {
    var contents: string = "";
    var row;
    for (row of data) {
      contents += buildRow(row);
    }

    var template = "http://admin{0}.siltranscriber.org/main/{1}/{2}-plan/{3}/{4}/3";

    var link = _format(template, [stageToProgram(),
    data[0].attributes.organizationid.toString(),
    data[0].attributes.plantype.toLowerCase(),
    data[0].attributes.projectid.toString(),
    data[0].attributes.planid.toString()]);
    return projplan_html
      .replace("{projplanlink}", link)
      .replace("{ProjPlan}", data[0].attributes.project + ' - ' + data[0].attributes.plan)
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
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

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
      .replace("{{App}}", strings.App)
      .replace("{{Subject}}", strings.Subject)
      .replace("{daterows}", contents)
      .replace("{{Preferences}}", strings.Preferences)
      .replace("{ProfileLink}", _format("https://admin{0}.siltranscriber.org/profile", [stageToProgram()]))
      .replace("{Year}", (new Date()).getFullYear().toString())
      .replace("{{SIL}}", strings.SIL);
  }
  function sendEmail(to: string, body: string, subject: string) {
    const from: string = getEnvVarOrThrow(process.env.SIL_TR_FROM_EMAIL);
    const captureTo: string = getEnvVarOrDefault(process.env.SIL_TR_URLPATH, "/dev") == "/dev" ? "sara_hentzel@wycliffe.org" : to;
    console.table(to);
    var payload = {
      ToAddresses: [captureTo],
      BodyHtml: body,
      Subject: captureTo === to ? subject : "daily digest for " + to,
      FromEmail: from
    }
    var params = {
      FunctionName: 'SendSESEmail', // the lambda function we are going to invoke
      InvocationType: 'RequestResponse',
      LogType: 'Tail',
      Payload: JSON.stringify(payload)
    };
    config.region = 'us-east-1';
    const lambda = new Lambda();

    lambda.invoke(params, function (err, data) {
      if (err) {
        console.log(err);
        context.fail(err);
      } else {
        console.log("Success");
        context.succeed('SendSES said ' + data.Payload);
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


    getChanges(since.toISOString()).then(function (data: IDataRow[]) {
      console.log("returned data", data.length);
      if (data.length > 0) {
        var email: string = data[0].attributes.email;
        var start: number = 0;
        var end: number = 0;
        var strings: EmailStrings = getUserStrings(data[0].attributes.locale)
        var row: any;
        console.log("call Userstrings");
        UserStrings('fr').then(function (newstrings: EmailStrings) {
          console.log(newstrings);
          for (row of data) {
            if (row.attributes.email != email) {
              console.log("send to ", email, start, end - 1);
              sendEmail(email,
                buildEmailNHE(data.slice(start, end), strings), strings.Subject);
              start = end;
              email = row.attributes.email
            }
            end = end + 1;
          }
          console.log("send to ", email, start, end - 1);
          sendEmail(email,
            buildEmailNHE(data.slice(start, end), strings), strings.Subject);
        }, function (serr: any) { console.log("user strings error", serr) });
      }
    }, function (err) { console.log(err) });

  } catch (e) {
    console.log("catch");
    console.log(e);
    callback(e, undefined);
  }
};

export { handler }
