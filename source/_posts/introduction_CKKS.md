---
title: Gentle Introduction to Homomorphic Encryption and CKKS
date: 2025-09-22 7:00:00
category: Cryptography
math: true
---

# Series Overview

In this multipart series, we'll dive deep into CKKS. In this first part, we'll go through a short primer on Homomorphic Encryption and the CKKS Encryption Scheme. We'll defer the maths (as much as possible) to the later parts in this series, and instead try to build an intuition for things in this first part.

---


# Introduction to Homomorphic Encryption

Homomorphic Encryption (HE) schemes allow computations to be performed **directly on encrypted data**, without ever needing to decrypt it. This is a departure from traditional cryptography schemes, where data must be decrypted before it can be processed. This allows for a moment of vulnerability that attackers can target.

### Privacy-Preserving Applications

Homomorphic Encryption schemes have great implications for privacy and security of data. For example consider

- **Medical Records**: Sending sensitive medical records to a cloud server for machine learning inference
- **Financial Analysis**: Outsourcing financial data analysis to an untrusted third party  
- **Data Processing**: Performing computations on sensitive datasets

With standard encryption, your data must be exposed to compute on it. With HE, the server can run its computations **blindly**, never seeing your actual data.

### What Makes CKKS Special?

CKKS is one example of a Homomorphic Encryption scheme.

It stands out in particular because it enables **approximate arithmetic** on real and complex numbers. While other HE schemes (like BFV or BGV) work over exact integers, CKKS allows us to perform operations on vectors of complex values.

---

# Homomorphic Encryption Fundamentals

## Core Components

At its core, an **encryption scheme** consists of three fundamental algorithms:

### 1. Key Generation

$$
(\mathsf{pk}, \mathsf{sk}) \;\leftarrow\; \mathsf{KeyGen}(1^\lambda)
$$

Generates a public key $\mathsf{pk}$ and a secret key $\mathsf{sk}$ based on a security parameter $\lambda$.

### 2. Encryption

$$
c \;\leftarrow\; \mathsf{Enc}(\mathsf{pk}, m)
$$

Encrypts a message $m$ into a ciphertext $c$ using the public key.

### 3. Decryption

$$
m \;\leftarrow\; \mathsf{Dec}(\mathsf{sk}, c)
$$

Recovers the original message $m$ from the ciphertext using the secret key.


## The Homomorphic Property

A scheme is said to be **homomorphic** if it supports an additional **evaluation algorithm**:

$$
\mathsf{Eval}(\mathsf{pk}, f, c_1, \dots, c_t)
$$

such that, for some function $f$ and messages $m_1, \dots, m_t$:

$$
\mathsf{Dec}\Big(\mathsf{sk}, \mathsf{Eval}\big(\mathsf{pk}, f, 
\mathsf{Enc}(\mathsf{pk}, m_1), \dots, \mathsf{Enc}(\mathsf{pk}, m_t)\big)\Big) 
\;\approx\; f(m_1, \dots, m_t)
$$

> **Note**: There are a couple of problems with this definition. For a more exact definition, see [Craig Thesis](https://crypto.stanford.edu/craig/craig-thesis.pdf).

\
**The important insight is that** 

> **You can perform computations directly on encrypted data**, and when you decrypt the result, you get (approximately) the same output as if you had computed on the plaintexts.

An interesting point to note is that everytime we perform a computation on the encrypted data, we increase the noise level of the encrypted data. If we perform too many operations, the noise level increases to the point that we can no longer decrypt the data to get our message back. This forms the basis for classification of Homomorphic Encryption Schemes.


## Classification of Homomorphic Encryption Schemes

Homomorphic encryption schemes can be classified based on what operations you can perform on the encrypted data (which are valid under the homomorphic property) and the number of times you can perform this operation before the noise renders decryption meaningless.

### Partially Homomorphic Encryption (PHE)
These schemes support only one type of operation (either addition or multiplication) with no practical limit on the number of operations.

- **RSA**: Supports unlimited multiplications
- **ElGamal**: Supports unlimited multiplications  
- **Paillier**: Supports unlimited additions


### Somewhat Homomorphic Encryption (SHE)
These schemes support both addition and multiplication operations, but only for a limited number of operations before noise accumulation makes decryption impossible.

- **BGV**: Supports both addition and multiplication, but limited depth


### Fully Homomorphic Encryption (FHE)
FHE schemes support both addition and multiplication and can perform an unlimited number of computations by using a technique called **bootstrapping** to refresh ciphertexts and reduce noise accumulation.

- **Bootstrapped CKKS**: Unlimited operations through bootstrapping
- **TFHE**: Fast bootstrapping for boolean circuits


### Key Distinctions

| Scheme Type | Operations | Depth Limit | Plaintext Type |
|-------------|------------|-------------|----------------|
| **BGV/BFV** | +, × | Limited (SHE) | Integers |
| **CKKS** | +, × | Unlimited (FHE) | Real/Complex |
| **Paillier** | + only | Unlimited | Integers |
| **RSA** | × only | Unlimited | Integers |

---

# CKKS Introduction
CKKS is a fully homomorphic encryption scheme designed for approximate arithmetic on complex numbers. It allows operations on a vector of floating point numbers which makes it ideal for applications in machine learning etc

## Polynomial Rings

A **polynomial ring** is a set of polynomials with coefficients from a given [ring](https://math.libretexts.org/Bookshelves/Combinatorics_and_Discrete_Mathematics/Applied_Discrete_Structures_(Doerr_and_Levasseur)/16%3A_An_Introduction_to_Rings_and_Fields/16.01%3A_Rings_Basic_Definitions_and_Concepts) (like integers, $\mathbb{Z}$) where we can perform **addition and multiplication**.  

Formally, the ring of polynomials with integer coefficients is written as:

$$
\mathbb{Z}[x] = \{ a_0 + a_1 x + a_2 x^2 + \dots + a_n x^n \mid a_i \in \mathbb{Z}, \; n \ge 0 \}
$$

- **Addition:** Coefficients of like powers of $x$ are added.  
- **Multiplication:** Polynomials are multiplied using distributive law.

## Quotient Polynomial Ring

A **quotient polynomial ring** modulo a polynomial $f(x)$ is written as:

$$
R = \mathbb{Z}[x] / (f(x))
$$

Here, two polynomials are considered equivalent if their difference is a multiple of $f(x)$:

$$
p(x) \equiv q(x) \pmod{f(x)} \iff p(x) - q(x) \text{ is divisible by } f(x)
$$

Think of this like the modular arithmetic equivalent for polynomials. 

Just as $17 \equiv 2 \pmod{5}$, in $R$ we might have:
$$
x^N \equiv -1 \pmod{x^N+1}.
$$

> Example: In CKKS, we use
>
> $$
> R_q = \mathbb{Z}_q[x]/(x^N + 1)
> $$
>
> where coefficients are integers modulo $q$ (set of integers modulo q is the ring), and $x^N + 1$ defines the equivalence relation.




## Message/Plaintext Space

Suppose we have a vector of $n$ messages. CKKS does **not directly operate on this vector of complex numbers**. Instead, it maps a vector

$$
\mathbf{m} = (m_1, m_2, \dots, m_{n}) \in \mathbb{C}^{n} 
$$

into a polynomial in the plaintext space (quotient polynomial ring) via the **encoding algorithm**:

$$
\text{Encode}_\Delta: \mathbb{C}^n \;\longrightarrow\; R_q = \mathbb{Z}_q[x]/(x^N + 1)
$$

$(R_q)$ is known as the $2(N)$-th cyclotomic ring modulo $(q)$.  

> 
> If the polynomial modulus degree is $N$, the scheme actually supports encoding vectors of size:
> 
> $$
> \mathbf{m} = (m_1, m_2, \dots, m_{N/2}) \in \mathbb{C}^{N/2}.
> $$
> 
> This is because the canonical embedding (more on this in the next part) of the ring $R = \mathbb{Z}[x]/(x^N+1)$ into $\mathbb{C}^N$ has conjugate symmetry, leaving only $N/2$ independent slots.

\
So the idea is that we take a vector of complex/real numbers that each represent a message, and then encode them into **ONE** polynomial. This means whenever we operate on this polynomial, we are effectively operating on all the original complex/real numbers that were part of the vector.

This gives rise to the **SIMD** like property of CKKS.

## Encryption / Decryption

The **encryption algorithm** maps the encoded polynomial into a ciphertext (pair of polynomials):

$$
\text{Enc}: R_\Delta \;\longrightarrow\; \text{Ciphertext } (c_0(x), c_1(x)) \in R_q \times R_q
$$

The **decryption algorithm** maps a ciphertext back into the encoded polynomial:

$$
\text{Dec}: (c_0(x), c_1(x)) \;\longrightarrow\; m(x) \in R_\Delta
$$

Finally, the **decoding algorithm** maps the polynomial back to an approximate vector of complex numbers:

$$
\text{Decode}_\Delta: R_\Delta \;\longrightarrow\; \mathbf{\tilde{m}} \in \mathbb{C}^n, \quad \mathbf{\tilde{m}} \approx \mathbf{m}
$$

\
So encryption of one polynomial generates a pair of polynomials which together form the ciphertext. This is the encrypted form of our original message vector. We can now perform operations on two ciphertexts (such as addition of two ciphertexts, multiplication of two ciphertexts), and then decrypt the resulting ciphertext to get a plaintext polynomial back. Note that we are yet to obtain our vector of complex/real numbers back, this is done by **Decoding** the plaintext polynomial which will convert it to a vector of complex numbers.


### Summary of Algorithm Mappings

| Algorithm       | Input Space          | Output Space                       |
|-----------------|-------------------|----------------------------------|
| Encode          | $\mathbb{C}^n$     | $R_\Delta \subset R_q$           |
| Encrypt         | $R_\Delta$          | $R_q \times R_q$ (ciphertext)    |
| Decrypt         | $R_q \times R_q$   | $R_\Delta$                        |
| Decode          | $R_\Delta$          | $\mathbb{C}^n$ (approximate)     |

## Special SIMD Property of CKKS

One of the powerful features of CKKS is that it can **pack a whole vector of complex numbers into a single polynomial**.  

- Suppose we have a vector of messages:  

$$
\mathbf{m} = (m_1, m_2, \dots, m_n) \in \mathbb{C}^n
$$

- After **encoding**, all these values are embedded into **one polynomial**:  

$$
m(x) \in R_\Delta \subset R_q
$$

- The magic is that **any homomorphic operation on \(m(x)\)** , like addition or multiplication, is **applied simultaneously to all the packed values**.  

This is similar to **SIMD (Single Instruction, Multiple Data)** in classical computing: a single operation is performed on **multiple pieces of data at once**.  

> In other words: CKKS allows us to treat the polynomial as a container of multiple messages and perform computations on the whole vector **in parallel**, all in the encrypted domain.


# Why Isn’t Homomorphic Encryption Everywhere?

It does sound amazing to be able to compute directly on encrypted data without ever decrypting it.  
So why isn’t Homomorphic Encryption (HE) used everywhere yet?  

There are a few important reasons:


**1. Computational Overhead**  
- HE schemes are still **orders of magnitude slower** than plaintext computation.  
- For example, a simple multiplication between two ciphertexts can be up to **100× slower** than multiplying two integers.  
- Ciphertexts are also much larger than plaintexts, and intermediate results (especially after multiplications) can balloon in size, consuming significant memory.  


**2. Limited Support for Non-Polynomial Functions**  
- HE schemes natively operate over **polynomial rings**.  
- This makes it challenging to evaluate non-polynomial functions such as **sigmoid** or **ReLU** (common in machine learning).  
- We can try to approximate such functions using polynomials but these can reduce accuracy.  


**3. Noise Growth**  
- Each homomorphic operation increases the **noise** in a ciphertext.  
- Once the noise exceeds a threshold, decryption fails. This effectively means we can only perform a fixed number of operations. If we exceed this number, we lose the original message permanently.
- Bootstrapping can refresh ciphertexts (resetting the noise), but this step is extremely costly in practice.  


**4. Deployment Challenges**  
- HE requires specialized cryptographic libraries and expertise.  
- Integrating it into existing pipelines (databases, ML frameworks, etc.) is still non-trivial compared to standard encryption.  


# Wrapping up
We will conclude part one of this series here. I hope this introduction to Homomorphic Encryption and CKKS was enough to pique your curiosity. In the next part of the series, we will dive deeper into the maths - starting with the canonical embedding and how they are used to perform the encoding/decoding step.

PS – I am still a novice in this almost mystical world of Homomorphic Encryption. If you spot any mistakes or if you'd like to discuss anything further, I’d greatly appreciate it if you reach out to me via [X](https://x.com/21verses)

# References
[Craig Thesis on Homomorphic Encryption](https://crypto.stanford.edu/craig/craig-thesis.pdf)

[The original CKKS Paper - Homomorphic Encryption for Arithmetic of Approximate Numbers](https://eprint.iacr.org/2016/421.pdf)

[CKKS Explained by Openmined](https://openmined.org/blog/ckks-explained-part-1-simple-encoding-and-decoding/)