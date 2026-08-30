---
id: users.shadow-aging-fields
title: Reading /etc/shadow
rhel: 9
objectives: [users.passwords.aging, users.accounts.manage]
sources: [r9:ch6, r10:ch6]
---
Password aging looks like a pile of unrelated commands until you see that all
of them write to the same nine colon-separated fields of one line in
`/etc/shadow`. Learn the line and the commands stop mattering.

```
student:$6$xxxx:19800:0:30:7:14:20000:
   1      2       3   4  5 6  7    8  9
```

1. **username**
2. **hashed password** — `!` or `!!` at the front means locked, `*` means the
   account can never log in with a password, empty means no password at all
3. **last change**, in days since 1 Jan 1970
4. **minimum days** before the password may be changed again
5. **maximum days** the password is valid — this is `chage -M`
6. **warning days** before expiry
7. **inactive days** after expiry before the account is disabled
8. **account expiry date**, again in days since the epoch — this is `chage -E`
9. unused

Two of these are constantly confused. **Field 5 expires the password**: the
user is forced to choose a new one and can still get in. **Field 8 expires the
account**: the user cannot log in at all, no matter what the password is. A
question about a contractor's last day means field 8. A question about a
security policy means field 5.

Three ways to write the same thing:

```
chage -M 30 alice        # field 5
passwd -x 30 alice       # field 5, same result
chage -E 2027-06-30 carol   # field 8, converted to days for you
```

Read it back with `chage -l alice`, which prints the fields as dates, or with
`getent shadow alice` if you want to see the raw numbers. `getent` needs root —
`/etc/shadow` is mode 000 by design.

The gotcha worth remembering: `chage -E` accepts a date, but field 8 stores a
day count, so a value of `0` does not mean "never" — it means 1 Jan 1970, and
the account is expired. "Never" is `-1`, written as `chage -E -1`.
