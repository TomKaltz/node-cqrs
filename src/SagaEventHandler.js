/* eslint new-cap: "off" */
'use strict';

const Observer = require('./Observer');
const { isClass, coWrap } = require('./utils');

const _eventStore = Symbol('eventStore');
const _commandBus = Symbol('commandBus');
const _createSaga = Symbol('createSaga');
const _handles = Symbol('handles');
const _queueName = Symbol('queueName');

/**
 * Listens to Saga events,
 * creates new saga or restores it from event store,
 * applies new events
 * and passes command(s) to command bus
 */
module.exports = class SagaEventHandler extends Observer {

	constructor(options) {
		if (!options) throw new TypeError('options argument required');
		if (!options.sagaType) throw new TypeError('options.sagaType argument required');
		if (!options.eventStore) throw new TypeError('options.eventStore argument required');
		if (!options.commandBus) throw new TypeError('options.commandBus argument required');

		super();

		Object.defineProperties(this, {
			[_eventStore]: {
				value: options.eventStore
			},
			[_commandBus]: {
				value: options.commandBus
			},
			[_createSaga]: {
				value: isClass(options.sagaType) ?
					params => new options.sagaType(params) :
					options.sagaType
			},
			[_handles]: {
				value: options.handles || options.sagaType.handles
			},
			[_queueName]: {
				value: options.queueName
			}
		});

		coWrap(this, 'handle');
	}

	/**
	 * Overrides observer subscribe method
	 */
	subscribe(eventStore) {
		Observer.subscribe(eventStore, this, {
			messageTypes: this[_handles],
			masterHandler: this.handle,
			queueName: this[_queueName]
		});
	}

	/**
	 * Handle saga event
	 *
	 * @param {object} event
	 * @returns {Promise<object[]>}
	 */
	* handle(event) {
		if (!event) throw new TypeError('event argument required');
		if (!event.type) throw new TypeError('event.type argument required');

		let saga;
		if (event.sagaId) {
			if (typeof event.sagaVersion === 'undefined') throw new TypeError('event.sagaVersion argument required, when event.sagaId provided');

			const events = yield this[_eventStore].getSagaEvents(event.sagaId, {
				before: event.sagaVersion,
				except: event.id
			});

			saga = this[_createSaga]({ id: event.sagaId, events });

			this.info(`saga ${saga.id} state restored from ${events.length === 1 ? '1 event' : `${events.length} events`}`);
		}
		else {
			const id = yield this[_eventStore].getNewId();

			saga = this[_createSaga]({ id });

			this.info(`saga ${saga.id} instance created`);
		}

		saga.apply(event);

		const commands = saga.uncommittedMessages;
		const commandsLog = commands.length === 1 ? `'${commands[0].type}' command` : `${commands.length} commands`;

		this.info(`saga ${saga.id} '${event.type}' event produced ${commandsLog}`);

		return yield commands.map(command => {
			command.context = event.context;
			return this[_commandBus].sendRaw(command);
		});
	}
};
