'use strict';

const debug = require('debug')('cqrs:debug:Container');
const getClassDependencyNames = require('./getClassDependencyNames');
const _factories = Symbol('factories');
const _instances = Symbol('instances');

function isClass(func) {
	return typeof func === 'function'
		&& Function.prototype.toString.call(func).startsWith('class');
}

function isObject(instance) {
	return typeof instance === 'object'
		&& instance != null
		&& !Array.isArray(instance)
		&& !(instance instanceof Date);
}


function createInstance(typeOrFactory, container, additionalOptions) {
	if (typeof typeOrFactory !== 'function') throw new TypeError('typeOrFactory argument must be a Function');
	if (!container) throw new TypeError('container argument required');
	if (additionalOptions && !isObject(additionalOptions))
		throw new TypeError('additionalOptions argument, when specified, must be an Object');

	if (isClass(typeOrFactory)) {
		const Type = typeOrFactory;

		const dependencies = getClassDependencyNames(Type);
		if (!dependencies)
			debug(`${Type.name || 'class'} has no constructor`);
		else if (!dependencies.length)
			debug(`${Type.name || 'class'} has no dependencies`);
		else
			debug(`${Type.name || 'class'} dependencies: ${dependencies}`);

		const parameters = dependencies ?
			dependencies.map(dependency => {
				if (typeof dependency === 'string') {
					return container[dependency];
				}
				else if (Array.isArray(dependency)) {
					const options = Object.assign({}, additionalOptions);
					dependency.forEach(key => options[key] || (options[key] = container[key]));
					return options;
				}
				return undefined;
			}) : [];

		return new Type(...parameters);
	}

	return typeOrFactory(container);
}


module.exports = class Container {

	/**
	 * Registered component factories
	 * @type {(function)[]}
	 * @readonly
	 */
	get factories() {
		return this[_factories] || (this[_factories] = []);
	}

	/**
	 * Component instances
	 * @type {object}
	 * @readonly
	 */
	get instances() {
		return this[_instances] || (this[_instances] = {});
	}

	/**
	 * Creates an instance of Container
	 */
	constructor() {
		this.registerInstance(this, 'container');
	}

	/**
	 * Registers a type or factory in the container
	 * @param  {Function} 	typeOrFactory	Either a constructor function or a component factor
	 * @param  {String} 	exposeAs      	Optional component name to use for instance exposing on the container
	 * @param  {Function} 	exposeMap     	Optional Instance -> Object-to-Expose mapping
	 * @return {void}
	 */
	register(typeOrFactory, exposeAs, exposeMap) {
		if (typeof typeOrFactory !== 'function') throw new TypeError('typeOrFactory argument must be a Function');
		if (exposeAs && typeof exposeAs !== 'string') throw new TypeError('exposeAs argument, when provided, must be a non-empty string');
		if (exposeMap && typeof exposeMap !== 'function') throw new TypeError('exposeMap argument, when provided, must be a function');

		const factory = container => container.createInstance(typeOrFactory);

		if (exposeAs) {
			Object.defineProperty(this, exposeAs, {
				configurable: true,
				get() {
					return this.instances[exposeAs]
						|| (this.instances[exposeAs] = exposeMap ? exposeMap(factory(this)) : factory(this));
				}
			});

			this.factories.push(container => container[exposeAs]);
		}
		else {
			factory.unexposed = true;
			this.factories.push(factory);
		}
	}

	/**
	 * Registers an object instance in the container
	 * @param  {Object} instance Object instance to register
	 * @param  {String} exposeAs Object name to use for instance exposing on the container
	 * @return {undefined}
	 */
	registerInstance(instance, exposeAs) {
		if (!isObject(instance)) throw new TypeError('instance argument must be an Object');
		if (typeof exposeAs !== 'string' || !exposeAs.length) throw new TypeError('exposeAs argument must be a non-empty String');

		this.instances[exposeAs] = instance;

		Object.defineProperty(this, exposeAs, {
			get() {
				return this.instances[exposeAs];
			}
		});
	}

	/**
	 * Create instances for components that do not have lazy getters defined on the Container.
	 * For example, event or command handlers, that are not referenced from external components.
	 * @return {undefined}
	 */
	createUnexposedInstances() {
		debug('creating unexposed instances...');
		for (let i = 0; i < this.factories.length; i++) {
			if (this.factories[i].unexposed) {
				this.factories.splice(i, 1)[0](this);
				i -= 1;
			}
		}
	}

	/**
	 * Creates instances for all types or factories registered in the Container
	 * @return {undefined}
	 */
	createAllInstances() {
		debug('creating all instances...');
		while (this.factories.length)
			this.factories.splice(0, 1)[0](this);
	}

	/**
	 * Creates an instance from the given type or factory using dependency injection
	 * @param  {Function} typeOrFactory   Type or factory used to create an instance
	 * @param  {Object} additionalOptions Additional options to append to the parameter object of the type constructor
	 * @return {Object}                   Newly created instance
	 */
	createInstance(typeOrFactory, additionalOptions) {
		debug(`creating ${typeOrFactory.name || 'unnamed'} instance...`);

		return createInstance(typeOrFactory, this, additionalOptions);
	}
};
