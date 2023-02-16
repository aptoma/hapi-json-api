'use strict';

const Hapi = require('@hapi/hapi');
const Joi = require('@hapi/joi');
const assert = require('chai').assert;
const jsonapi = require('../');
const plugin = jsonapi.plugin;

describe('JSON API Plugin', () => {

	describe('Error formatting', () => {
		it('should format joi errors to more human readable output', async () => {
			const server = new Hapi.Server({debug: {request: '*'}});
			await server.register({plugin});
			server.route({
				method: 'POST',
				path: '/test',
				config: {
					validate: {
						failAction: (req, h, err) => err,
						payload: {
							fo: Joi.object({
								bar: Joi.object({
									banana: Joi.number().required()
								}).required()
							}).required()
						}
					},
					handler(req, h) {
						return h.response().code(204);
					}
				}
			});

			const res = await server.inject({method: 'POST', url: '/test', payload: {fo: {}}});
			assert.equal(res.result.errors[0].details, 'Validation error: "bar" is required (fo.bar)');
		});
	});

	describe('Decorated reply functions', () => {
		let server;

		function testReply(handler) {
			server.route({
				method: 'GET',
				path: '/test',
				handler: handler
			});

			return server.inject({method: 'GET', url: '/test'});
		}

		beforeEach(async () => {
			server = new Hapi.Server({debug: {request: '*'}});
			await server.register({plugin});
		});

		describe('#h.jsonApi()', () => {

			it('should format single object and reply', async () => {
				const model = new Model({id: 1, name: 'foo'});

				const res = await testReply((req, h) => h.jsonApi('models', model));

				assert.deepEqual(res.result, {
					data: {
						type: 'models',
						id: 1,
						attributes: {
							name: 'foo'
						},
						relationships: {
							foos: {data: []}
						}
					}
				});
			});

			it('should format collection and reply', async () => {
				const model = new Model({id: 1, name: 'foo'});

				const res = await testReply((req, h) => h.jsonApi('models', [model]));

				assert.deepEqual(res.result, {
					data: [{
						type: 'models',
						id: 1,
						attributes: {
							name: 'foo'
						},
						relationships: {
							foos: {data: []}
						}
					}]
				});
			});

			it('should format and reply with options', async () => {
				const model = new Model({id: 1, name: 'foo'});

				const res = await testReply(
					(req, reply) => reply.jsonApi('models', [model], {meta: {foo: 'bar'}})
				);

				assert.deepEqual(res.result, {
					data: [{
						type: 'models',
						id: 1,
						attributes: {
							name: 'foo'
						},
						relationships: {
							foos: {data: []}
						}
					}],
					meta: {
						foo: 'bar'
					}
				});
			});
		});

		describe('#reply.jsonApiFunction()', () => {

			it('should format single object and reply', async () => {
				const model = new Model({id: 1, name: 'foo'});

				const res = await testReply((req, reply) => reply.jsonApiFunction('models')(model));

				assert.deepEqual(res.result, {
					data: {
						type: 'models',
						id: 1,
						attributes: {
							name: 'foo'
						},
						relationships: {
							foos: {data: []}
						}
					}
				});
			});

			it('should format collection and reply', async () => {
				const model = new Model({id: 1, name: 'foo'});

				const res = await testReply((req, reply) => reply.jsonApiFunction('models')([model]));

				assert.deepEqual(res.result, {
					data: [{
						type: 'models',
						id: 1,
						attributes: {
							name: 'foo'
						},
						relationships: {
							foos: {data: []}
						}
					}]
				});
			});

			it('should format and reply with options', async () => {
				const model = new Model({id: 1, name: 'foo'});

				const res = await testReply(
					(req, reply) => reply.jsonApiFunction('models', {meta: {foo: 'bar'}})(model)
				);

				assert.deepEqual(res.result, {
					data: {
						type: 'models',
						id: 1,
						attributes: {
							name: 'foo'
						},
						relationships: {
							foos: {data: []}
						}
					},
					meta: {
						foo: 'bar'
					}
				});
			});

			it('should format and reply with custom statuscode', async () => {
				const model = new Model({id: 1, name: 'foo'});

				const res = await testReply((req, reply) => reply.jsonApiFunction('models', {}, 201)(model));

				assert.equal(res.statusCode, 201);
				assert.deepEqual(res.result, {
					data: {
						type: 'models',
						id: 1,
						attributes: {
							name: 'foo'
						},
						relationships: {
							foos: {data: []}
						}
					}
				});
			});
		});
	});

	describe('toAPI()', () => {

		it('should format data according to jsonapi.org spec', () => {
			const model = new Model({id: 1, name: 'foo'});
			const result = jsonapi.toAPI('models', model, {includedRelationships: []});
			assert.deepEqual(result, {
				type: 'models',
				id: 1,
				attributes: {
					name: 'foo'
				},
				relationships: {
					foos: {data: []}
				},
				included: []
			});
		});

		it('should support named relationships', () => {
			const model = new Model({id: 1, name: 'foo'}, namedRelationships);
			const result = jsonapi.toAPI('models', model);
			assert.deepEqual(result, {
				type: 'models',
				id: 1,
				attributes: {
					name: 'foo'
				},
				relationships: {
					myFoos: {data: []}
				}
			});
		});

		it('should support raw json data', () => {
			const result = jsonapi.toAPI('models', {name: 'foo', id: 'foo'});
			assert.deepEqual(result, {
				type: 'models',
				id: 'foo',
				attributes: {
					name: 'foo'
				}
			});
		});
	});

	describe('formatObject()', () => {

		it('should append meta at top level', () => {
			const model = new Model({name: 'foo'});
			const meta = {foo: 'bar'};
			const result = jsonapi.formatObject('models', model, {
				meta: meta
			});
			assert.deepEqual(result.meta, meta);
		});

		it('should format data according to jsonapi.org spec and wrap in `data` field', () => {
			const foos = [{id: '1', name: 'foo1'}, {id: '2', name: 'foo2'}];
			const model = new Model({id: 1, name: 'foo', foos: foos});
			const result = jsonapi.formatObject('models', model);
			assert.deepEqual(result, {
				data: {
					type: 'models',
					id: 1,
					attributes: {
						name: 'foo'
					},
					relationships: {
						foos: {
							data: [
								{type: 'foos', id: '1'},
								{type: 'foos', id: '2'}
							]
						}
					}
				}
			});
		});
	});

	describe('formatCollection()', () => {

		it('should format data according to jsonapi.org spec and wrap in `data` field', () => {
			const model = new Model({id: 1, name: 'foo'});
			const result = jsonapi.formatCollection('models', [model]);
			assert.deepEqual(result, {
				data: [{
					type: 'models',
					id: 1,
					attributes: {
						name: 'foo'
					},
					relationships: {
						foos: {data: []}
					}
				}]
			});
		});

		it('should append meta at top level', () => {
			const model = new Model({name: 'foo'});
			const meta = {foo: 'bar'};
			const result = jsonapi.formatCollection('models', [model], {
				meta: meta
			});
			assert.deepEqual(result.meta, meta);
		});

		it('should place included resources on the top level', () => {
			const model = new Model({
				id: 1,
				name: 'foo',
				foos: [{id: 123, name: 'foo-1'}]
			});

			const result = jsonapi.formatCollection('models', [model], {
				includedRelationships: ['foos']
			});

			assert.deepEqual(result, {
				data: [{
					type: 'models',
					id: 1,
					attributes: {
						name: 'foo'
					},
					relationships: {
						foos: {data: [
							{type: 'foos', id: 123}
						]}
					}
				}],
				included: [
					{type: 'foos', id: 123, attributes: {
						name: 'foo-1'
					}}
				]
			});
		});

		it('should only include each included resource once', () => {
			const model1 = new Model({
				id: 1,
				name: 'foo',
				foos: [{id: 123, name: 'foo-1'}]
			});

			const model2 = new Model({
				id: 2,
				name: 'bar',
				foos: [
					{id: 123, name: 'foo-1'},
					{id: 456, name: 'foo-2'}
				]
			});

			const result = jsonapi.formatCollection('models', [model1, model2], {
				includedRelationships: ['foos']
			});

			assert.lengthOf(result.included, 2);
			assert.deepEqual(result.included, [
				{type: 'foos', id: 123, attributes: {name: 'foo-1'}},
				{type: 'foos', id: 456, attributes: {name: 'foo-2'}}
			]);
		});

	});

});

function namedRelationships() {
	return [{type: 'foos', items: this.data.foos || [], name: 'myFoos'}];
}

class Model {
	constructor(data, relationships) {
		this.data = data;
		this.relationships = relationships || function () {
			return [{type: 'foos', items: this.data.foos || []}];
		};
	}

	get id() {
		return this.data.id || Math.ceil(Math.random() * 1000);
	}

	getRelationships() {
		return this.relationships();
	}

	toJSON() {
		return this.data;
	}
}
