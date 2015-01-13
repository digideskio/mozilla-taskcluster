import exchange from '../src/exchange';
import publisher from '../src/publisher';
import toJSONSchema from 'joi-to-json-schema';
import assert from 'assert';
import { createClient, AMQPListener } from 'taskcluster-client';
import waitFor from './wait_for';

let Joi = require('joi');

suite('publisher', function() {

  let Exchange = exchange('magicfoo').
    name('doMagicFoo').
    title('I am the magic foo').
    description('wootbar').
    routingKeys(
      { name: 'first', summary: 'yup' },
      { name: 'second', summary: 'sum', multipleWords: true, required: false }
    ).
    schema(Joi.object().unknown(false).keys({
      wootbar: Joi.string().required(),
      number: Joi.number().required()
    }));

  let subject, listener;
  setup(async function() {
    subject = await publisher({
      title: 'tests',
      description: 'super test',
      connectionString: this.config.commitPublisher.connectionString,
      exchangePrefix: 'test/'
    });

    // create the exchange each time to ensure we are in known state.
    await subject.assertExchanges(Exchange);

    listener = new AMQPListener({
      connectionString: this.config.commitPublisher.connectionString
    });
  });

  teardown(async function() {
    await subject.close();
  });

  test('toSchema()', function() {
    let schema = subject.toSchema(Exchange);
    let expected = {
      title: subject.title,
      description: subject.description,
      exchangePrefix: subject.exchangePrefix,
      entries: [{
        type: 'topic-exchange',
        exchange: Exchange.config.exchange,
        name: Exchange.config.name,
        title: Exchange.config.title,
        description: Exchange.config.description,
        routingKey: [
          { name: 'first', summary: 'yup', multipleWords: false, required: true },
          { name: 'second', summary: 'sum', multipleWords: true, required: false }
        ],
        schema: toJSONSchema(Exchange.config.schema)
      }]
    };
    assert.deepEqual(schema, expected);
  });

  test('publish()', async function() {
    let XfooEvents = createClient(subject.toSchema(Exchange));
    let events = new XfooEvents();
    assert.ok(events.doMagicFoo);

    let publish = async function() {
      await subject.publish(
        Exchange,
        { first: 'first', second: 'second' },
        { wootbar: 'is wootbar', number: 5 }
      );
    };

    listener.bind(events.doMagicFoo());

    let message;
    listener.on('message', function(msg) {
      message = msg;
    })

    // Run an initial publish as we may not have created the exchange yet...
    await publish();
    await listener.resume();

    await subject.publish(
      Exchange,
      { first: 'first', second: 'second' },
      { wootbar: 'is wootbar', number: 5 }
    );

    await waitFor(async function() {
      return !!message;
    });

    assert.deepEqual(message.payload, {
      wootbar: 'is wootbar',
      number: 5
    });

    assert.equal(message.routingKey, 'first.second');
    assert.deepEqual(message.routing, {
      first: 'first',
      second: 'second'
    });
  });
});
