package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
)

var errConflict = errors.New("Something changed on another device. Review the latest values before saving again.")

type Store struct {
	revision string
	mu       sync.RWMutex
	path     string
	data     *Data
	raw      []byte
	problem  error
}

func fingerprint(raw []byte) string { hash := sha256.Sum256(raw); return hex.EncodeToString(hash[:]) }
func openStore(path string) (*Store, error) {
	raw, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	s := &Store{path: path, data: emptyData(), raw: raw, revision: fingerprint(raw)}
	if err == nil {
		s.data, s.problem = decodeData(raw)
		if s.problem != nil {
			s.data = emptyData()
		}
	}
	return s, nil
}

// Published datasets are immutable; only commit callbacks receive a private copy.
func (s *Store) snapshot() (*Data, string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data, s.revision, s.problem
}
func (s *Store) backup() []byte { s.mu.RLock(); defer s.mu.RUnlock(); return bytes.Clone(s.raw) }
func (s *Store) update(revision string, replace *Data, change func(*Data) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if revision != s.revision {
		return errConflict
	}
	if s.problem != nil && replace == nil {
		return fmt.Errorf("Your data needs attention: %w", s.problem)
	}
	next := replace
	if next == nil {
		next = cloneData(s.data)
		if err := change(next); err != nil {
			return err
		}
	} else {
		next = cloneData(next)
	}
	if err := next.validate(); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	if len(raw) > maxBytes {
		return errors.New("Data exceeds the 10 MB backup limit.")
	}
	if err := saveFile(s.path, raw); err != nil {
		return fmt.Errorf("Could not save workshop data: %w", err)
	}
	s.data, s.raw, s.problem = next, raw, nil
	s.revision = fingerprint(raw)
	return nil
}
func saveFile(path string, raw []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".smerp-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(raw); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
func decodeData(raw []byte) (*Data, error) {
	if len(raw) == 0 || len(raw) > maxBytes {
		return nil, errors.New("Choose a nonempty JSON backup no larger than 10 MB.")
	}
	// A backup is complete data, not a patch. Missing zero-valued fields must not silently become defaults.
	if err := requireFields(raw, reflect.TypeFor[Data]()); err != nil {
		return nil, err
	}
	var d Data
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&d); err != nil {
		return nil, fmt.Errorf("Cannot read backup: %w", err)
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return nil, errors.New("The backup contains trailing data.")
	}
	if err := d.validate(); err != nil {
		return nil, err
	}
	return &d, nil
}
func requireFields(raw []byte, t reflect.Type) error {
	if t.Kind() == reflect.Pointer {
		if bytes.Equal(raw, []byte("null")) {
			return nil
		}
		return requireFields(raw, t.Elem())
	}
	if bytes.Equal(raw, []byte("null")) {
		return errors.New("A backup field is null or invalid.")
	}
	switch t.Kind() {
	case reflect.Struct:
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			return err
		}
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			tag := strings.Split(f.Tag.Get("json"), ",")
			v, ok := fields[tag[0]]
			if !ok {
				if len(tag) > 1 && tag[1] == "omitempty" {
					continue
				}
				return fmt.Errorf("Backup field %s is missing.", tag[0])
			}
			if err := requireFields(v, f.Type); err != nil {
				return err
			}
		}
	case reflect.Slice:
		var list []json.RawMessage
		if err := json.Unmarshal(raw, &list); err != nil {
			return err
		}
		for _, v := range list {
			if err := requireFields(v, t.Elem()); err != nil {
				return err
			}
		}
	}
	return nil
}
