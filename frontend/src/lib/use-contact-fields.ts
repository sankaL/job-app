import { useState } from "react";

type ContactFields = {
  email: string;
  firstName: string;
  lastName: string;
  address: string;
  phone: string;
  linkedinUrl: string;
};

const EMPTY_CONTACT_FIELDS: ContactFields = {
  email: "",
  firstName: "",
  lastName: "",
  address: "",
  phone: "",
  linkedinUrl: "",
};

export function useContactFields() {
  const [fields, setFields] = useState<ContactFields>(EMPTY_CONTACT_FIELDS);
  const setField = (name: keyof ContactFields) => (value: string) => {
    setFields((current) => ({ ...current, [name]: value }));
  };

  return {
    ...fields,
    setEmail: setField("email"),
    setFirstName: setField("firstName"),
    setLastName: setField("lastName"),
    setAddress: setField("address"),
    setPhone: setField("phone"),
    setLinkedinUrl: setField("linkedinUrl"),
    resetContactFields: () => setFields(EMPTY_CONTACT_FIELDS),
  };
}
