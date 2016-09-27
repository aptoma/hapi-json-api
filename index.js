'use strict';

const R = require('ramda');

/**
 * @typedef {object} JSONAPIFormatOptions
 * @property {Account} [account]
 * @property {string[]} [includedRelationships]
 * @property {object} [meta]
 */

/**
 * @typedef {object} JSONAPIItem
 * @property {string} type
 * @property {string} id
 * @property {object} attributes
 * @property {object[]} [included]
 */

exports.formatObject = formatObject;
exports.formatCollection = formatCollection;
exports.toAPI = toAPI;

exports.register = function (server, options, next) {
	server.expose('formatObject', exports.formatObject);
	server.expose('formatObjectWithOptions', exports.formatObjectWithOptions);
	server.expose('formatCollection', exports.formatCollection);
	server.expose('formatCollectionWithOptions', exports.formatCollectionWithOptions);
	server.expose('toAPI', exports.toAPI);

	server.ext('onPreResponse', formatError);

	server.decorate('reply', 'jsonApi', replyJsonApi);
	server.decorate('reply', 'jsonApiFunction', replyJsonApiFunction);

	next();
};

exports.register.attributes = {
	name: 'service-jsonapi'
};

const internals = {
	deleteAndReturnProperty: R.curry(deleteAndReturnProperty)
};

/**
 * Format object(s) according to JSONAPI and add the result to the response
 *
 * @param  {String} type
 * @param  {Object|Array} objects items to format
 * @param {JSONAPIFormatOptions} [options]
 * @this Hapi.Reply
 * @return {Hapi.ResponseObject}
 */
function replyJsonApi(type, objects, options) {
	return replyFunction.bind(this)(type, objects, options); // jshint ignore:line
}

/**
 * Format object(s) according to JSONAPI and add the result to the response
 *
 * @param  {String} type
 * @param {JSONAPIFormatOptions} [options]
 * @param  {Integer} [code] sets statusCode
 * @this Hapi.Reply
 * @return {Function} returns curried replyFunction that accepts objects to format as a parameter.
 */
function replyJsonApiFunction(type, options, code) {
	return R.curry(R.bind(replyFunction, this))(type, R.__, options, code); // jshint ignore:line
}

/**
 * Format object(s) according to JSONAPI and add the result to the response
 *
 * @param  {String} type
 * @param  {Object|Array} objects items to format
 * @param {JSONAPIFormatOptions} [options]
 * @param  {Integer} [code] sets statusCode
 * @this Hapi.Reply
 * @return {Hapi.ResponseObject}
 */
function replyFunction(type, objects, options, code) {
	let resp;
	options = options || {};
	if (objects instanceof Array) {
		resp = this.response(formatCollection(type, objects, options)); // jshint ignore:line
	} else {
		resp = this.response(formatObject(type, objects, options)); // jshint ignore:line
	}

	if (code) {
		resp.code(code); // jshint ignore:line
	}

	return resp;
}

/**
 * onPreResponse handler for formatting error objects according to JSONAPI spec.
 * @param  {Hapi.Request} req
 * @param  {Hapi.Reply} reply
 * @return {Hapi.ResponseObject}
 */
function formatError(req, reply) {
	const response = req.response;
	if (!response.isBoom) {
		return reply.continue();
	}

	const errorObject = {
		status: String(response.output.statusCode),
		title: response.output.payload.error,
		details: response.output.payload.message
	};

	if (response.data) {
		// only output data to consumers in _expose
		if (response.data._expose) {
			errorObject.meta = response.data._expose;
		}

		// log all data for errors
		if (response.output.statusCode === 500) {
			req.log('error', response.data instanceof Buffer ? response.data.toString() : response.data);
		}
	}

	return reply({
		errors: [errorObject]
	}).code(response.output.statusCode);
}

/**
 * Format a collection according to JSON API spec
 *
 * @param {string} type
 * @param {Array} items
 * @param {JSONAPIFormatOptions} [options]
 * @return {Object}
 */
function formatCollection(type, items, options) {
	options = options || {};
	const data = items.map(R.curry(toAPI)(type, R.__, options));

	if (!options.includedRelationships) {
		return appendMeta(options.meta, {data: data});
	}

	const pullIncluded = R.compose(
		R.uniqBy(R.prop('id')),
		R.flatten,
		R.map(internals.deleteAndReturnProperty('included'))
	);

	return appendMeta(options.meta, {
		data: data,
		included: pullIncluded(data)
	});
}

function deleteAndReturnProperty(propertyName, obj) {
	const property = obj[propertyName];
	delete obj[propertyName];
	return property;
}

/**
 * Append meta to payload
 * @param  {Object} [meta]
 * @param  {Object} payload
 * @return {Object}
 */
function appendMeta(meta, payload) {
	if (!meta) {
		return payload;
	}
	payload.meta = meta;
	return payload;
}

/**
 * Format an object according to JSON API spec
 *
 * @param {string} type
 * @param {mongoose.Model|Object} object
 * @param {JSONAPIFormatOptions} [options]
 * @return {Object}
 */
function formatObject(type, object, options) {
	options = options || {};

	return appendMeta(options.meta, {
		data: toAPI(type, object, options)
	});
}

/**
 * Format an object according to JSON API spec
 *
 * @param {String} type
 * @param {Object} data
 * @param {JSONAPIFormatOptions} options
 * @return {JSONAPIItem}
 */
function toAPI(type, data, options) {
	options = options || {};
	const ret = {
		type: type,
		id: data.id || data._id,
		attributes: data.toJSON ? data.toJSON() : data
	};

	delete ret.attributes.id;
	delete ret.attributes._id;

	if (options.includedRelationships && options.includedRelationships.length) {
		ret.included = [];
	}

	if (R.is(Function, data.getRelationships)) {
		ret.relationships = {};
		data.getRelationships(options).forEach((relationship) => {
			delete ret.attributes[relationship.type];
			let relationshipData;

			if (relationship.item) {
				relationshipData = {
					type: relationship.type,
					id: relationship.item._bsontype ? relationship.item.toString() : relationship.item.id
				};

				if (ret.included && R.contains(relationship.type, options.includedRelationships)) {
					ret.included.push(toAPI(relationship.type, relationship.item));
				}
			} else if (relationship.items) {
				relationshipData = relationship.items.map((item) => {
					const data = {
						type: relationship.type,
						id: item.id
					};
					if (ret.included && R.contains(relationship.type, options.includedRelationships)) {
						ret.included.push(toAPI(relationship.type, item));
					}

					return data;
				});
			}

			ret.relationships[relationship.name || relationship.type] = {data: relationshipData};
		});
	}

	return ret;
}
