import { expect } from 'chai';
import { describe, it } from 'mocha';

import { GraphQLError } from '../../error/GraphQLError';

import type { FieldNode } from '../../language/ast';
import { parse } from '../../language/parser';

import { validate } from '../validate';
import type { ValidationContext } from '../ValidationContext';

import { testSchema } from './harness';

function expectErrorMessages(
  query: string,
  hideSuggestions?: boolean,
): ReadonlyArray<string> {
  const errors = validate(testSchema, parse(query), undefined, {
    hideSuggestions,
  });
  return errors.map((error) => error.message);
}

describe('Validate: Hide suggestions', () => {
  it('does not change error messages when the option is not provided', () => {
    expect(
      expectErrorMessages(`
        {
          dog {
            meowVolume
          }
        }
      `),
    ).to.deep.equal([
      'Cannot query field "meowVolume" on type "Dog". Did you mean "barkVolume"?',
    ]);
  });

  it('does not change error messages when the option is false', () => {
    expect(
      expectErrorMessages(
        `
        {
          dog {
            meowVolume
          }
        }
      `,
        false,
      ),
    ).to.deep.equal([
      'Cannot query field "meowVolume" on type "Dog". Did you mean "barkVolume"?',
    ]);
  });

  it('hides suggestions for misspelled fields', () => {
    expect(
      expectErrorMessages(
        `
        {
          dog {
            meowVolume
          }
        }
      `,
        true,
      ),
    ).to.deep.equal(['Cannot query field "meowVolume" on type "Dog".']);
  });

  it('hides suggestions for fields only available on other types', () => {
    expect(
      expectErrorMessages(
        `
        {
          pet {
            nickname
          }
        }
      `,
        true,
      ),
    ).to.deep.equal(['Cannot query field "nickname" on type "Pet".']);

    expect(
      expectErrorMessages(
        `
        {
          pet {
            nickname
          }
        }
      `,
        false,
      ),
    ).to.deep.equal([
      'Cannot query field "nickname" on type "Pet". Did you mean to use an inline fragment on "Cat" or "Dog"?',
    ]);
  });

  it('hides suggestions for misspelled arguments', () => {
    expect(
      expectErrorMessages(
        `
        {
          dog {
            doesKnowCommand(DogCommand: SIT)
          }
        }
      `,
        true,
      ),
    ).to.deep.equal([
      'Unknown argument "DogCommand" on field "Dog.doesKnowCommand".',
    ]);
  });

  it('hides suggestions for misspelled directive arguments', () => {
    expect(
      expectErrorMessages(
        `
        {
          dog @skip(iff: true) {
            name
          }
        }
      `,
        true,
      ),
    ).to.deep.equal([
      'Unknown argument "iff" on directive "@skip".',
      'Directive "@skip" argument "if" of type "Boolean!" is required, but it was not provided.',
    ]);
  });

  it('hides suggestions for misspelled type names', () => {
    expect(
      expectErrorMessages(
        `
        {
          cat: pet {
            ... on Dat {
              name
            }
          }
        }
      `,
        true,
      ),
    ).to.deep.equal(['Unknown type "Dat".']);
  });

  it('hides suggestions for misspelled input object fields', () => {
    expect(
      expectErrorMessages(
        `
        {
          complicatedArgs {
            complexArgField(complexArg: { requiredField: true, intFeeld: 1 })
          }
        }
      `,
        true,
      ),
    ).to.deep.equal([
      'Field "intFeeld" is not defined by type "ComplexInput".',
    ]);
  });

  it('hides suggestions for misspelled enum literals', () => {
    expect(
      expectErrorMessages(
        `
        {
          dog {
            doesKnowCommand(dogCommand: SITT)
          }
        }
      `,
        true,
      ),
    ).to.deep.equal([
      'Value "SITT" does not exist in "DogCommand" enum.',
    ]);
  });

  it('hides suggestions for non-enum literal values', () => {
    expect(
      expectErrorMessages(
        `
        {
          dog {
            doesKnowCommand(dogCommand: 42)
          }
        }
      `,
        true,
      ),
    ).to.deep.equal([
      'Enum "DogCommand" cannot represent non-enum value: 42.',
    ]);
  });

  it('hides subfield selection suggestions on scalar leafs', () => {
    expect(
      expectErrorMessages(
        `
        {
          dog
        }
      `,
        true,
      ),
    ).to.deep.equal([
      'Field "dog" of type "Dog" must have a selection of subfields.',
    ]);
  });

  it('keeps the number and locations of errors unchanged', () => {
    const query = `
      {
        dog {
          meowVolume
          nonExistent
        }
      }
    `;

    const errorsWithSuggestions = validate(testSchema, parse(query));
    const errorsWithoutSuggestions = validate(
      testSchema,
      parse(query),
      undefined,
      { hideSuggestions: true },
    );

    expect(errorsWithoutSuggestions).to.have.lengthOf(
      errorsWithSuggestions.length,
    );
    expect(
      errorsWithoutSuggestions.map((error) => error.locations),
    ).to.deep.equal(errorsWithSuggestions.map((error) => error.locations));
  });

  it('exposes the option to custom validation rules through the context', () => {
    function customRule(context: ValidationContext) {
      return {
        Field(node: FieldNode) {
          const fieldDef = context.getFieldDef();
          if (!fieldDef) {
            const fieldName = node.name.value;
            const suffix = context.hideSuggestions
              ? ''
              : ' Did you mean "dog"?';
            context.reportError(
              new GraphQLError(`Custom rule error for "${fieldName}".` + suffix, {
                nodes: node,
              }),
            );
          }
        },
      };
    }

    const query = `
      {
        dogg
      }
    `;

    expect(
      validate(testSchema, parse(query), [customRule]).map(
        (error) => error.message,
      ),
    ).to.deep.equal(['Custom rule error for "dogg". Did you mean "dog"?']);

    expect(
      validate(testSchema, parse(query), [customRule], {
        hideSuggestions: true,
      }).map((error) => error.message),
    ).to.deep.equal(['Custom rule error for "dogg".']);
  });
});
