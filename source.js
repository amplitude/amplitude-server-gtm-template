// Enter your template code here.
const getEventData = require('getEventData');
const getRemoteAddress = require('getRemoteAddress');
const getTimestampMillis = require('getTimestampMillis');
const JSON = require('JSON');
const log = require('logToConsole');
const makeInteger = require('makeInteger');
const makeTableMap = require('makeTableMap');
const parseUrl = require('parseUrl');
const sendHttpRequest = require('sendHttpRequest');

const HTTP_ENDPOINT = data.euServer ? 'https://api.eu.amplitude.com/2/httpapi' : 'https://api2.amplitude.com/2/httpapi';
const GA4_USER_PREFIX = 'x-ga-mp2-user_properties.';
const LOG_PREFIX = '[Amplitude] ';

const apiKey = data.apiKey;
const userIp = data.hideIp ? '$remote' : getRemoteAddress();
const userId = getEventData('user_id') || getEventData(GA4_USER_PREFIX + 'user_id') || undefined;
const deviceId = getEventData('client_id');
const sessionId = makeInteger(getEventData('ga_session_id') + '000');
const timestamp = getEventData('timestamp') || getTimestampMillis();
const eventName = getEventData('event_name');
const newEventProperties = data.newEventProperties && data.newEventProperties.length ? makeTableMap(data.newEventProperties, 'key', 'value') : {};
const newUserProperties = data.newUserProperties && data.newUserProperties.length ? makeTableMap(data.newUserProperties, 'key', 'value') : {};
const additionalProperties = data.additionalProperties && data.additionalProperties.length ? makeTableMap(data.additionalProperties, 'key', 'value') : {};

const logAmplitude = msg => {
  log(LOG_PREFIX + msg);
};

const mergeObj = (fromObj, toObj) => {
  for (let key in fromObj) {
    if (fromObj.hasOwnProperty(key) && fromObj[key] !== null && fromObj[key] !== undefined) {
      toObj[key] = fromObj[key];
    }
  }
  return toObj;
};

const getEventProps = () => {
  const props = {};
  if (data.eventProps && data.eventProps.length) {
    data.eventProps.forEach(p => {
      if (getEventData(p.key)) props[(p.mapKey || p.key)] = getEventData(p.key);
    });
  }
  return mergeObj(newEventProperties, props);
};

const getUserProps = () => {
  const props = {};
  // Automatically collect UTMs
  if (data.trackUtms) {
    const parsedUrl = parseUrl(getEventData('page_location')) || {searchParams: {}};
    props.utm_source = parsedUrl.searchParams.utm_source;
    props.utm_medium = parsedUrl.searchParams.utm_medium;
    props.utm_campaign = parsedUrl.searchParams.utm_campaign;
    props.utm_term = parsedUrl.searchParams.utm_term;
    props.utm_content = parsedUrl.searchParams.utm_content;
  }
  if (data.userProps && data.userProps.length) {
    data.userProps.forEach(p => {
      if (getEventData(p.key)) props[(p.mapKey || p.key)] = getEventData(p.key);
    });
  }
  return mergeObj(newUserProperties, props);
};

const parseEventType = eventName => {
  let eventType = data.blockIfNoMap ? null : eventName;
  if (data.eventName && data.eventName.length) {
    data.eventName.forEach(en => {
      if (en.eventName === eventName) eventType = en.eventType;
    });
  }
  return eventType;
};

const eventType = parseEventType(eventName);

if (!eventType) {
  logAmplitude('No event name match, aborting event dispatch.');
  return data.gtmOnSuccess();
}

const baseEvent = {
  device_id: deviceId,
  event_type: eventType,
  time: timestamp,
  event_properties: getEventProps(),
  user_properties: getUserProps(),
  ip: userIp,
  session_id: sessionId,
  insert_id: deviceId + eventName + timestamp
};

if (userId) baseEvent.user_id = userId;

// Merge final event from base event and additional properties. The latter overwrites.
const finalEvent = mergeObj(additionalProperties, baseEvent);

// Add library signature
finalEvent.library = 'S-GTM';

const postBody = {
  api_key: apiKey,
  events: [finalEvent]
}; 

sendHttpRequest(HTTP_ENDPOINT, (statusCode, headers, body) => {
  if (statusCode >= 400) {
    data.gtmOnFailure();
  } else {
    data.gtmOnSuccess();
  }
}, {headers: {'content-type': 'application/json'}, method: 'POST', timeout: 5000}, JSON.stringify(postBody));