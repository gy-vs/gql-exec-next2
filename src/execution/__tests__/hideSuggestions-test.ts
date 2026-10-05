import { expect } from 'chai';
import { describe, it } from 'mocha';

import { expectJSON } from '../../__testUtils__/expectJSON';

import { Kind } from '../../language/kinds';
import { parse } from '../../language/parser';

import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLObjectType,
} from '../../type/definition';
import { GraphQLString } from '../../type/scalars';
import { GraphQLSchema } from '../../type/schema';

import { executeSync } from '../execute';
import { getVariableValues } from '../values';

const ColorType = new GraphQLEnumType({
  name: 'Color',
  values: {
    RED: { value: 'RED' },
    GREEN: { value: 'GREEN' },
    BLUE: { value: 'BLUE' },
  },
});

const FilterInput = new GraphQLInputObjectType({
  name: 'FilterInput',
  fields: {
    color: { type: ColorType },
    name: { type: GraphQLString },
  },
});

const QueryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    color: {
      type: GraphQLString,
      args: { filter: { type: FilterInput } },
      resolve: () => 'ok',
    },
  },
});

const schema = new GraphQLSchema({ query: QueryType });

describe('Execute: Hide suggestions', () => {
  function executeWithVariables(
    query: string,
    variableValues: { readonly [variable: string]: unknown },
    hideSuggestions?: boolean,
  ) {
    return executeSync({
      schema,
      document: parse(query),
      variableValues,
      hideSuggestions,
    });
  }

  it('includes suggestions in variable enum errors by default', () => {
    const result = executeWithVariables(
      `
        query ($c: Color) {
          color(filter: { color: $c })
        }
      `,
      { c: 'RDE' },
    );

    expectJSON(result).toDeepEqual({
      errors: [
        {
          message:
            'Variable "$c" got invalid value "RDE"; Value "RDE" does not exist in "Color" enum. Did you mean the enum value "RED"?',
          locations: [{ line: 2, column: 16 }],
        }
      ],
    });
  });

  it('hides suggestions in variable enum errors', () => {
    const result = executeWithVariables(
      `
        query ($c: Color) {
          color(filter: { color: $c })
        }
      `,
      { c: 'RDE' },
      true,
    );

    expectJSON(result).toDeepEqual({
      errors: [
        {
          message:
            'Variable "$c" got invalid value "RDE"; Value "RDE" does not exist in "Color" enum.',
          locations: [{ line: 2, column: 16 }],
        }
      ],
    });
  });

  it('includes suggestions for unknown input object fields in variables by default', () => {
    const result = executeWithVariables(
      `
        query ($filter: FilterInput) {
          color(filter: $filter)
        }
      `,
      { filter: { naem: 'foo' } },
    );

    expectJSON(result).toDeepEqual({
      errors: [
        {
          message:
            'Variable "$filter" got invalid value { naem: "foo" }; Field "naem" is not defined by type "FilterInput". Did you mean "name"?',
          locations: [{ line: 2, column: 16 }],
        }
      ],
    });
  });

  it('hides suggestions for unknown input object fields in variables', () => {
    const result = executeWithVariables(
      `
        query ($filter: FilterInput) {
          color(filter: $filter)
        }
      `,
      { filter: { naem: 'foo' } },
      true,
    );

    expectJSON(result).toDeepEqual({
      errors: [
        {
          message:
            'Variable "$filter" got invalid value { naem: "foo" }; Field "naem" is not defined by type "FilterInput".',
          locations: [{ line: 2, column: 16 }],
        }
      ],
    });
  });

  it('keeps non-suggestion parts of variable errors unchanged', () => {
    const query = `
      query ($c: Color, $filter: FilterInput) {
        color(filter: $filter)
      }
    `;
    const withSuggestions = executeWithVariables(
      query,
      { c: 'RDE', filter: { color: 'RDE', naem: 'foo' } },
    );
    const withoutSuggestions = executeWithVariables(
      query,
      { c: 'RDE', filter: { color: 'RDE', naem: 'foo' } },
      true,
    );

    const withMessages = (withSuggestions.errors ?? []).map(
      (error) => error.message,
    );
    const withoutMessages = (withoutSuggestions.errors ?? []).map(
      (error) => error.message,
    );

    expect(withoutMessages).to.have.lengthOf(withMessages.length);
    for (let i = 0; i < withoutMessages.length; i++) {
      expect(withMessages[i].startsWith(withoutMessages[i])).to.equal(true);
      expect(withoutMessages[i]).to.not.include('Did you mean');
    }
  });

  describe('getVariableValues', () => {
    const doc = parse(`
      query ($c: Color, $filter: FilterInput) {
        color(filter: $filter)
      }
    `);
    const operation = doc.definitions[0];
    if (operation.kind !== Kind.OPERATION_DEFINITION) {
      throw new Error('Expected operation definition');
    }
    const { variableDefinitions } = operation;
    if (variableDefinitions == null) {
      throw new Error('Expected variable definitions');
    }

    const inputs = { c: 'RDE', filter: { collor: 'RED' } };

    it('includes suggestions by default', () => {
      const result = getVariableValues(schema, variableDefinitions, inputs);

      expectJSON(result).toDeepEqual({
        errors: [
          {
            message:
              'Variable "$c" got invalid value "RDE"; Value "RDE" does not exist in "Color" enum. Did you mean the enum value "RED"?',
            locations: [{ line: 2, column: 14 }],
          },
          {
            message:
              'Variable "$filter" got invalid value { collor: "RED" }; Field "collor" is not defined by type "FilterInput". Did you mean "color"?',
            locations: [{ line: 2, column: 25 }],
          },
        ],
      });
    });

    it('hides suggestions when the option is enabled', () => {
      const result = getVariableValues(schema, variableDefinitions, inputs, {
        hideSuggestions: true,
      });

      expectJSON(result).toDeepEqual({
        errors: [
          {
            message:
              'Variable "$c" got invalid value "RDE"; Value "RDE" does not exist in "Color" enum.',
            locations: [{ line: 2, column: 14 }],
          },
          {
            message:
              'Variable "$filter" got invalid value { collor: "RED" }; Field "collor" is not defined by type "FilterInput".',
            locations: [{ line: 2, column: 25 }],
          },
        ],
      });
    });

    it('does not change messages when the option is false', () => {
      const hidden = getVariableValues(schema, variableDefinitions, inputs, {
        hideSuggestions: false,
      });
      const shown = getVariableValues(schema, variableDefinitions, inputs);
      expectJSON(hidden).toDeepEqual(shown);
    });
  });
});
