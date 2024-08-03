import express from 'express';
import axios from 'axios';
import { createEvents } from 'ics';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import mailgun from 'mailgun-js';

// Load environment variables from .env file
dotenv.config();
console.log('Environment variables loaded');

// Initialize Express
const app = express();
app.use(bodyParser.json());
console.log('Express app initialized');

// Initialize Mailgun
const mg = mailgun({ apiKey: process.env.MAILGUN_API_KEY, domain: process.env.MAILGUN_DOMAIN });

// Store the previous events
let previousEvents = [];

const graphqlQuery = {
  query: `query MyQuery {
    events (where: {display: {_neq: "private"}, start_time: {_gte: "2024-06-01T00:00:00.000Z"}, _and: {start_time: {_lte: "2025-01-01T00:00:00.000Z"}}, group_id: {_eq: 3452}, status: {_in: ["open", "new", "normal"]}} order_by: {start_time: asc}, limit: 2000, offset: 0) {
      id
      title
      start_time
      end_time
      location
      content
    }
  }`,
  operationName: "MyQuery"
};

const fetchEvents = async () => {
  console.log('Fetching events from GraphQL API...');
  const response = await axios.post('https://graph.sola.day/v1/graphql', graphqlQuery, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': '*/*',
    }
  });
  console.log('Events fetched successfully:', response.data.data.events);

  return response.data.data.events.map(event => ({
    id: event.id,
    title: event.title,
    start_time: event.start_time,
    end_time: event.end_time,
    location: event.location || 'No location provided.',
    content: event.content || 'No description provided.',
  }));
};

const checkForChanges = (newEvents) => {
  console.log('Checking for changes in events...');
  if (previousEvents.length === 0) {
    console.log('No previous events found. Storing current events as previous events.');
    previousEvents = newEvents;
    return false;
  }

  const changes = newEvents.filter((newEvent, index) => {
    const prevEvent = previousEvents[index];
    return (
      newEvent.title !== prevEvent.title ||
      newEvent.start_time !== prevEvent.start_time ||
      newEvent.end_time !== prevEvent.end_time ||
      newEvent.location !== prevEvent.location ||
      newEvent.content !== prevEvent.content
    );
  });

  console.log('Changes detected:', changes);
  previousEvents = newEvents;
  return changes.length > 0;
};

const sendNotificationEmail = (changes) => {
  console.log('Sending notification email with changes...');
  const emailData = {
    from: process.env.MAILGUN_EMAIL_USER,
    to: process.env.MAILGUN_RECIPIENT_EMAIL,
    subject: 'Event Changes Detected',
    text: `The following events have changed:\n\n${JSON.stringify(changes, null, 2)}`,
  };

  mg.messages().send(emailData, (error, body) => {
    if (error) {
      console.error('Error sending email with Mailgun:', error);
    } else {
      console.log('Notification email sent successfully:', body);
    }
  });
};

app.get('/calendar.ics', async (req, res) => {
  try {
    console.log('Received request for /calendar.ics');
    const newEvents = await fetchEvents();
    const eventsChanged = checkForChanges(newEvents);

    if (eventsChanged) {
      sendNotificationEmail(newEvents);
    }

    const events = newEvents.map(event => ({
      start: event.start_time.split(/[-T:.Z]/).map(Number),
      end: event.end_time.split(/[-T:.Z]/).map(Number),
      title: event.title,
      description: `🔗 https://aleph.sola.day/event/detail/${event.id}\n\n${event.content}`,
      location: event.location,
      status: 'CONFIRMED',
    }));

    console.log('Creating iCal events...');
    const { error, value } = createEvents(events);

    if (error) {
      console.error('Error creating iCal events:', error);
      return res.status(500).send('Internal Server Error');
    }

    const calendarName = 'Aleph Events Calendar';
    const calendarContent = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Your Organization//Your Product//EN\nX-WR-CALNAME:${calendarName}\n${value.replace('BEGIN:VEVENT', 'BEGIN:VEVENT')}\nEND:VCALENDAR`;

    console.log('iCal events created successfully');
    res.setHeader('Content-Disposition', 'attachment;filename=calendar.ics');
    res.setHeader('Content-Type', 'text/calendar');
    res.send(calendarContent);
  } catch (error) {
    console.error('Error in /calendar.ics endpoint:', error);
    res.status(500).send('Internal Server Error');
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

export default app;